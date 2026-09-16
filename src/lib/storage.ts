import fs from 'fs';
import path from 'path';

const DATA_DIR = path.join(process.cwd(), 'data');
const TRANSACTIONS_FILE = path.join(DATA_DIR, 'transactions.json');
const TASKS_FILE = path.join(DATA_DIR, 'tasks.json');

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

export interface Transaction {
  id: string;
  agentName: string;
  fileNumber: string;
  propertyAddress: string;
  purchasePrice: number;
  status: string;
  createdAt: string;
}

export interface Task {
  id: string;
  transactionId: string;
  name: string;
  completed: boolean;
  createdAt: string;
}

// Transactions
export function loadTransactions(): Transaction[] {
  try {
    if (fs.existsSync(TRANSACTIONS_FILE)) {
      const data = fs.readFileSync(TRANSACTIONS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading transactions:', error);
  }
  return [];
}

export function saveTransactions(transactions: Transaction[]): void {
  try {
    fs.writeFileSync(TRANSACTIONS_FILE, JSON.stringify(transactions, null, 2));
  } catch (error) {
    console.error('Error saving transactions:', error);
  }
}

export function createTransaction(agentName: string, fileNumber: string, propertyAddress: string, purchasePrice: number): Transaction {
  const transaction: Transaction = {
    id: Math.random().toString(36).substr(2, 9),
    agentName,
    fileNumber,
    propertyAddress,
    purchasePrice,
    status: 'Contract Pending',
    createdAt: new Date().toISOString(),
  };
  
  const transactions = loadTransactions();
  transactions.push(transaction);
  saveTransactions(transactions);
  
  return transaction;
}

// Tasks
export function loadTasks(): Task[] {
  try {
    if (fs.existsSync(TASKS_FILE)) {
      const data = fs.readFileSync(TASKS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (error) {
    console.error('Error loading tasks:', error);
  }
  return [];
}

export function saveTasks(tasks: Task[]): void {
  try {
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks, null, 2));
  } catch (error) {
    console.error('Error saving tasks:', error);
  }
}

export function createTasks(transactionId: string, taskNames: string[]): Task[] {
  const tasks = loadTasks();
  const newTasks = taskNames.map((name) => ({
    id: Math.random().toString(36).substr(2, 9),
    transactionId,
    name,
    completed: false,
    createdAt: new Date().toISOString(),
  }));
  tasks.push(...newTasks);
  saveTasks(tasks);
  return newTasks;
}

export function getTasksByTransaction(transactionId: string): Task[] {
  return loadTasks().filter((task) => task.transactionId === transactionId);
}

export function toggleTask(taskId: string): void {
  const tasks = loadTasks();
  const task = tasks.find((t) => t.id === taskId);
  if (task) {
    task.completed = !task.completed;
    saveTasks(tasks);
  }
}
