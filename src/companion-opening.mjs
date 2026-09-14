import { DEFAULT_PREMIUM_UPGRADE_URL } from './persona-entitlements.mjs';

export function premiumPersonaLearningAction() {
  return {
    id: 7,
    key: 'premium-personas',
    label: 'Read about premium personas',
    url: DEFAULT_PREMIUM_UPGRADE_URL,
    authority: 'none'
  };
}

const baseActions = [
  { id: 1, key: 'capture', label: 'Capture something new' },
  { id: 2, key: 'movable-intent', label: 'Pick up an intent that can move forward' },
  { id: 3, key: 'explore', label: 'Explore an idea and shape connected intents' },
  { id: 4, key: 'knowledge', label: 'Explore the Mind Palace, risks, or standards' },
  { id: 5, key: 'recommendations', label: 'See recommendations and possible next work' }
];

export function companionOpening(options = {}) {
  const actions = [...baseActions];
  if (options.hasWork) {
    actions.push({ id: 6, key: 'continue', label: 'Continue a piece of work' });
  }
  if(options.premiumActive!==true){
    actions.push(premiumPersonaLearningAction());
    actions.push({ id: 8, key: 'premium-persona-setup', label: 'Set up premium personas', command: 'ewai persona premium configure --project .', authority: 'verify-and-install-consent-required' });
  }
  actions.push({id:9,key:'dashboard-configuration',label:'Configure the dashboard',skill:'ewai-dashboard-configuration',command:'ewai dashboard preferences --project .',authority:'preference-save-consent-required'});

  return {
    schema: 'ewai.companion-opening/v1',
    presentation: 'mandatory-numbered-menu',
    heading: 'What would you like to do?',
    output: { routineStatusLines: 4, progressMaxWords: 24, errorMaxWords: 60,
      details: 'on-request', preserveWarnings: true, repeatMenu: 'only-at-next-decision' },
    actions,
    personaSetup: options.licenceNotConfigured === true && options.premiumActive!==true ? {
      question: 'Do you have a premium persona licence, or shall we use the core personas?',
      choices: [
        { key: 'configure', label: 'Set up a licence privately', command: 'ewai persona premium configure --project .' },
        { key: 'read', label: 'Read about personas first', url: DEFAULT_PREMIUM_UPGRADE_URL },
        { key: 'core', label: 'Keep using the core personas' }
      ]
    } : null,
    spotlight: options.spotlight ?? null,
    activePersonas: options.activePersonas ?? [],
    notices: options.notices ?? null,
    closingPrompt: "What's on your mind?",
    contract: [
      'Report the check-in status before the menu in four routine lines; retain blockers, warnings and unknown checks with short reasons. Detailed diagnostics are on request.',
      'Do not repeat the menu while carrying out a selected action. Give at most one short progress sentence per meaningful checkpoint; no shell/file/JSON narration or running commentary about reasoning.',
      'Render every action in order as `[id] label`.',
      'Action [7] is optional learning only; reading cannot activate, purchase or download personas.',
      'Do not replace the menu with narrative, recommendations, or a generic question.',
      'When spotlight is present, render its bounded advisory context and active persona names and tiers after the numbered actions.',
      'When personaSetup is present, ask its exact question after the menu and before closingPrompt. Respect a decline. Action [8] uses the guarded dashboard password form by default; a private terminal prompt is an alternative only when a genuine interactive terminal is available. Explain that key submission verifies and immediately installs the pack. Confirm installed readiness before chosen Archaeology. Reading and session checks never download.',
      'End the opening with the exact closingPrompt.'
    ]
  };
}
