export const TASK_TEMPLATES = {
  realEstate: [
    'Pre-Inspection',
    'Inspection',
    'Appraisal',
    'Underwriting',
    'Funding',
    'Closing',
  ],
};

export function getTemplateByType(type: string = 'realEstate'): string[] {
  return TASK_TEMPLATES[type as keyof typeof TASK_TEMPLATES] || TASK_TEMPLATES.realEstate;
}
