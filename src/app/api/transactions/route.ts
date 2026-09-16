import { NextRequest, NextResponse } from 'next/server';
import { loadTransactions, saveTransactions, createTransaction, Transaction } from '@/lib/storage';

export async function GET() {
  try {
    const transactions = loadTransactions();
    return NextResponse.json(transactions);
  } catch (error) {
    return NextResponse.json({ error: 'Failed to load transactions' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { agentName, fileNumber, propertyAddress, purchasePrice } = body;

    const transaction = createTransaction(agentName, fileNumber, propertyAddress, purchasePrice);
    return NextResponse.json(transaction, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Failed to create transaction' }, { status: 500 });
  }
}
