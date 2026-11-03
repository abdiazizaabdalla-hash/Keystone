import { NextRequest, NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase';

export async function GET(request: NextRequest) {
  try {
    // Extract auth token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Get current user from Supabase
    const { data: { user }, error: userError } = await supabaseServer.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get user's full metadata to check if admin
    const { data: userData, error: metaError } = await supabaseServer.auth.admin.getUserById(user.id);
    const isAdmin = userData?.user_metadata?.is_admin === true;

    let query = supabaseServer
      .from('agents')
      .select('*');

    // If not admin, only show their own agents
    if (!isAdmin) {
      query = query.eq('tc_user_id', user.id);
    }

    const { data, error } = await query.order('created_at', { ascending: false });

    if (error) throw error;

    return NextResponse.json(data);
  } catch (error) {
    console.error('Error fetching agents:', error);
    return NextResponse.json({ error: 'Failed to fetch agents' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    // Extract auth token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Get current user from Supabase
    const { data: { user }, error: userError } = await supabaseServer.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { name, brokerage, email, phone, flatFee, percentFee } = body;

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
        details: error
      }, { status: 500 });
    }

    return NextResponse.json(agent, { status: 201 });
  } catch (error) {
    console.error('Error creating agent:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to create agent: ${errorMsg}` }, { status: 500 });
  }
}

export async function PATCH(request: NextRequest) {
  try {
    // Extract auth token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Get current user from Supabase
    const { data: { user }, error: userError } = await supabaseServer.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { id, name, brokerage, email, phone, flatFee, percentFee } = body;

    if (!id) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
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
      .eq('tc_user_id', user.id)
      .select()
      .single();

    if (error) {
      console.error('Supabase update error:', error);
      return NextResponse.json({
        error: error.message || 'Failed to update agent',
        details: error
      }, { status: 500 });
    }

    return NextResponse.json(agent);
  } catch (error) {
    console.error('Error updating agent:', error);
    const errorMsg = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `Failed to update agent: ${errorMsg}` }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    // Extract auth token from Authorization header
    const authHeader = request.headers.get('authorization');
    if (!authHeader?.startsWith('Bearer ')) {
      return NextResponse.json({ error: 'Missing or invalid authorization token' }, { status: 401 });
    }

    const token = authHeader.slice(7);

    // Get current user from Supabase
    const { data: { user }, error: userError } = await supabaseServer.auth.getUser(token);
    if (userError || !user) {
      console.error('Auth error:', userError);
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json({ error: 'Agent ID is required' }, { status: 400 });
    }

    const { error } = await supabaseServer
      .from('agents')
      .delete()
      .eq('id', id)
      .eq('tc_user_id', user.id);

    if (error) throw error;

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Error deleting agent:', error);
    return NextResponse.json({ error: 'Failed to delete agent' }, { status: 500 });
  }
}
