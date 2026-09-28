import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { assertTrialActive, TrialExpiredError } from '@/lib/trial';
import { getPlanLimits } from '@/lib/plans';
import { getVisibleTcUserIds } from '@/lib/team';

export async function GET(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);

    let query = supabaseServer
      .from('agents')
      .select('*')
      .order('created_at', { ascending: false });

    if (!isAdmin) {
      const visibleIds = await getVisibleTcUserIds(user.id);
      query = query.in('tc_user_id', visibleIds);
    }

    const { data, error } = await query;

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error fetching agents:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { name, brokerage, email, phone, flatFee, percentFee } = body;

    // Plan-gated: Starter is capped at 1 agent profile. Admins creating
    // agents for themselves are still subject to their own plan's limit —
    // is_admin only affects cross-tenant visibility, not billing tier.
    const { maxAgents } = getPlanLimits(user.user_metadata?.plan);
    if (maxAgents !== null) {
      const { count, error: countError } = await supabaseServer
        .from('agents')
        .select('id', { count: 'exact', head: true })
        .eq('tc_user_id', user.id);

      if (countError) throw countError;

      if ((count || 0) >= maxAgents) {
        return NextResponse.json(
          {
            error: `Your plan allows up to ${maxAgents} agent profile${maxAgents === 1 ? '' : 's'}. Upgrade to add more.`,
            code: 'plan_limit_reached',
          },
          { status: 403 }
        );
      }
    }

    const { data: agent, error } = await supabaseServer
      .from('agents')
      .insert({
        tc_user_id: user.id,
        name,
        brokerage: brokerage || null,
        email: email || null,
        phone: phone || null,
        flat_fee: flatFee !== undefined ? parseFloat(String(flatFee)) : 400,
        commission_percent: percentFee !== undefined ? parseFloat(String(percentFee)) : 0,
      })
      .select()
      .single();

    if (error) {
      console.error('Supabase insert error:', error);
      return NextResponse.json({
        error: error.message || 'Failed to create agent',
      }, { status: 500 });
    }

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    console.error('Error creating agent:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to create agent: ${errorMsg}` }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    await assertTrialActive(user);
    const body = await request.json();
    const { id, name, brokerage, email, phone, flatFee, percentFee } = body;

    if (!id) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
    }

    if (!isAdmin) {
      const { data: existing } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('tc_user_id', user.id)
        .single();

      if (!existing) {
        return NextResponse.json({ error: 'You do not have permission to update this agent' }, { status: 403 });
      }
    }

    const { data: agent, error } = await supabaseServer
      .from('agents')
      .update({
        name,
        brokerage: brokerage || null,
        email: email || null,
        phone: phone || null,
        flat_fee: flatFee !== undefined ? parseFloat(String(flatFee)) : 400,
        commission_percent: percentFee !== undefined ? parseFloat(String(percentFee)) : 0,
      })
      .eq('id', id)
      .select()
      .single();

    if (error) {
      console.error('Supabase update error:', error);
      return NextResponse.json({
        error: error.message || 'Failed to update agent',
      }, { status: 500 });
    }

    return NextResponse.json(agent);
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof TrialExpiredError) {
      return NextResponse.json(
        { error: error.message, code: 'trial_expired', trialEndsAt: error.trialEndsAt },
        { status: error.status }
      );
    }
    console.error('Error updating agent:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to update agent: ${errorMsg}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user, isAdmin } = await getUserFromRequest(request);
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
    }

    if (!isAdmin) {
      const { data: existing } = await supabaseServer
        .from('agents')
        .select('id')
        .eq('id', id)
        .eq('tc_user_id', user.id)
        .single();

      if (!existing) {
        return NextResponse.json({ error: 'You do not have permission to delete this agent' }, { status: 403 });
      }
    }

    const { error } = await supabaseServer
      .from('agents')
      .delete()
      .eq('id', id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof AuthError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error('Error deleting agent:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
