// Shared vocabulary for the automation foundation (Auto-0). BUILT: types only. Nothing here acts on its own.

export type AutomationMode = 'off' | 'draft' | 'auto';

/** Things that can happen on a deal or listing. Emitters write these to transaction_events. */
export const EVENT_TYPES = [
  'contract_uploaded',
  'document_added',
  'step_ticked',
  'date_changed',
  'deal_closed',
] as const;
export type EventType = (typeof EVENT_TYPES)[number];

/** Actions the engine may take or propose. Anything not listed here cannot be run, whatever a saved config or a model says. */
export const ACTION_KINDS = [
  'create_task',
  'add_note',
  'suggest_tick',
  'classify_document',
  'file_document',
  'set_date',
  'send_step_email',
  'send_deal_email',
  'notify_user',
] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Never done by the assistant (plan 16.3 "Never done alone", and money). The guard refuses these in every mode. */
export const RESTRICTED_ACTIONS = [
  'sign_document',
  'waive_contingency',
  'change_contract_terms',
  'change_commission',
  'create_invoice',
  'record_payment',
  'delete_deal',
  'change_permissions',
  'choose_between_conflicting_dates',
] as const;
export type RestrictedAction = (typeof RESTRICTED_ACTIONS)[number];

/** Actions that reach someone outside Relay. */
export const EXTERNAL_ACTIONS: readonly string[] = ['send_step_email', 'send_deal_email'];

/** Actions that change contract dates: always need a person's explicit approval, even in Auto (plan section 6). */
export const ALWAYS_APPROVE_ACTIONS: readonly string[] = ['set_date'];

export type ActionStatus =
  | 'proposed'
  | 'awaiting_approval'
  | 'approved'
  | 'executed'
  | 'refused'
  | 'failed'
  | 'cancelled'
  | 'deferred';
