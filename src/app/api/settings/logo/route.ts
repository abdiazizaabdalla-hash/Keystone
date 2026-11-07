import { NextRequest, NextResponse } from 'next/server';
import { getUserFromRequest, AuthError } from '@/lib/auth';
import { loadLogo, logoPreviewUrl, removeLogo, saveLogo } from '@/lib/brandLogo';
import { MAX_LOGO_BYTES } from '@/lib/logoFormat';

// The logo printed at the top of this person's PDFs. Their own, never shared across accounts.

export async function GET(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const has = Boolean(await loadLogo(user.id));
    return NextResponse.json({ hasLogo: has, url: has ? await logoPreviewUrl(user.id) : null });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error reading logo:', error);
    return NextResponse.json({ error: 'Could not load your logo' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    const form = await request.formData();
    const file = form.get('file');
    if (!(file instanceof File)) return NextResponse.json({ error: 'Choose an image to upload.' }, { status: 400 });
    if (file.size > MAX_LOGO_BYTES) return NextResponse.json({ error: 'That image is over 1 MB. Use a smaller one.' }, { status: 400 });
    try {
      await saveLogo(user.id, Buffer.from(await file.arrayBuffer()));
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      if (/PNG or JPEG|over 1 MB/.test(message)) return NextResponse.json({ error: message }, { status: 400 });
      throw error;
    }
    return NextResponse.json({ hasLogo: true, url: await logoPreviewUrl(user.id) });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error saving logo:', error);
    return NextResponse.json({ error: 'Could not save your logo' }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { user } = await getUserFromRequest(request);
    await removeLogo(user.id);
    return NextResponse.json({ hasLogo: false, url: null });
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: error.status });
    console.error('Error removing logo:', error);
    return NextResponse.json({ error: 'Could not remove your logo' }, { status: 500 });
  }
}
