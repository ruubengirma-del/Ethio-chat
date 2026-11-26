import firebaseConfig from '../../firebase-applet-config.json';

interface GisPromptNotification {
  isDisplayed?: () => boolean;
  isNotDisplayed?: () => boolean;
  isSkippedMoment?: () => boolean;
  isDismissedMoment?: () => boolean;
  getNotDisplayedReason?: () => string;
  getSkippedReason?: () => string;
  getDismissedReason?: () => string;
}

interface GisCredentialResponse {
  credential?: string;
  select_by?: string;
}

interface GoogleAccountsIdApi {
  initialize: (config: {
    client_id: string;
    callback: (response: GisCredentialResponse) => void;
    auto_select?: boolean;
    cancel_on_tap_outside?: boolean;
    use_fedcm_for_prompt?: boolean;
    itp_support?: boolean;
    context?: 'signin' | 'signup' | 'use';
  }) => void;
  prompt: (listener?: (notification: GisPromptNotification) => void) => void;
  renderButton: (
    parent: HTMLElement,
    options: {
      theme?: 'outline' | 'filled_blue' | 'filled_black';
      size?: 'large' | 'medium' | 'small';
      text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
      shape?: 'rectangular' | 'pill' | 'circle' | 'square';
      width?: number | string;
      logo_alignment?: 'left' | 'center';
    }
  ) => void;
  cancel: () => void;
}

declare global {
  interface Window {
    google?: {
      accounts?: {
        id?: GoogleAccountsIdApi;
      };
    };
  }
}

export type InAppGooglePromptResult =
  | { status: 'credential'; idToken: string }
  | { status: 'dismissed' }
  | { status: 'unavailable'; reason?: string };

let initializedClientId: string | null = null;
let activeCredentialListener: ((response: GisCredentialResponse) => void) | null = null;
let scriptLoadPromise: Promise<boolean> | null = null;

export function getGoogleOAuthClientId(): string {
  return (firebaseConfig as { oAuthClientId?: string }).oAuthClientId || '';
}

function getGisIdApi(): GoogleAccountsIdApi | null {
  if (typeof window === 'undefined') return null;
  return window.google?.accounts?.id || null;
}

export function preloadGoogleIdentity(): Promise<boolean> {
  if (getGisIdApi()) {
    ensureGisInitialized();
    return Promise.resolve(true);
  }
  if (typeof document === 'undefined') return Promise.resolve(false);
  if (scriptLoadPromise) return scriptLoadPromise;

  scriptLoadPromise = new Promise<boolean>((resolve) => {
    const existing = document.querySelector<HTMLScriptElement>(
      'script[src*="accounts.google.com/gsi/client"]'
    );
    const finish = (ok: boolean) => {
      if (ok) ensureGisInitialized();
      resolve(ok);
    };

    if (existing) {
      const start = Date.now();
      const poll = () => {
        if (getGisIdApi()) {
          finish(true);
          return;
        }
        if (Date.now() - start > 3000) {
          finish(false);
          return;
        }
        window.setTimeout(poll, 80);
      };
      poll();
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = () => finish(Boolean(getGisIdApi()));
    script.onerror = () => finish(false);
    document.head.appendChild(script);
  });

  return scriptLoadPromise;
}

function ensureGisInitialized(): boolean {
  const api = getGisIdApi();
  const clientId = getGoogleOAuthClientId();
  if (!api || !clientId) return false;

  if (initializedClientId !== clientId) {
    api.initialize({
      client_id: clientId,
      callback: (response: GisCredentialResponse) => {
        activeCredentialListener?.(response);
      },
      auto_select: false,
      cancel_on_tap_outside: true,
      use_fedcm_for_prompt: true,
      itp_support: true,
      context: 'signin',
    });
    initializedClientId = clientId;
  }
  return true;
}

/**
 * Triggers Google One Tap / FedCM in-app account chooser directly inside the app/TWA
 * so the user sees all Google emails on their device without opening Chrome.
 * Must be invoked synchronously inside the click handler when GIS is preloaded.
 */
export function promptInAppGoogleChooser(): Promise<InAppGooglePromptResult> {
  const api = getGisIdApi();
  if (!api || !ensureGisInitialized()) {
    return Promise.resolve({ status: 'unavailable', reason: 'gis_not_loaded' });
  }

  return new Promise<InAppGooglePromptResult>((resolve) => {
    let settled = false;
    let timeoutId: number | null = null;

    const settle = (result: InAppGooglePromptResult) => {
      if (settled) return;
      settled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
      activeCredentialListener = null;
      resolve(result);
    };

    activeCredentialListener = (response: GisCredentialResponse) => {
      if (response?.credential) {
        settle({ status: 'credential', idToken: response.credential });
      } else {
        settle({ status: 'unavailable', reason: 'empty_credential' });
      }
    };

    // Safety timeout if neither moment callback nor credential fires
    timeoutId = window.setTimeout(() => {
      settle({ status: 'unavailable', reason: 'timeout' });
    }, 45000);

    try {
      api.prompt((notification: GisPromptNotification) => {
        if (settled) return;

        if (notification.isNotDisplayed?.()) {
          const reason = notification.getNotDisplayedReason?.() || 'not_displayed';
          settle({ status: 'unavailable', reason });
          return;
        }

        if (notification.isSkippedMoment?.()) {
          const reason = notification.getSkippedReason?.() || 'skipped';
          settle({ status: 'unavailable', reason });
          return;
        }

        if (notification.isDismissedMoment?.()) {
          const reason = notification.getDismissedReason?.() || 'dismissed';
          if (reason === 'credential_returned') {
            // Credential callback arrives immediately right alongside this moment
            window.setTimeout(() => {
              if (!settled) settle({ status: 'unavailable', reason: 'credential_timeout' });
            }, 600);
          } else {
            window.setTimeout(() => {
              if (!settled) settle({ status: 'dismissed' });
            }, 120);
          }
        }
      });
    } catch {
      settle({ status: 'unavailable', reason: 'prompt_threw' });
    }
  });
}

export function renderInAppGoogleButton(
  container: HTMLElement | null,
  onCredential: (idToken: string) => void
): boolean {
  if (!container) return false;
  const api = getGisIdApi();
  if (!api || !ensureGisInitialized()) return false;

  activeCredentialListener = (response: GisCredentialResponse) => {
    if (response?.credential) {
      onCredential(response.credential);
    }
  };

  try {
    container.innerHTML = '';
    api.renderButton(container, {
      theme: 'outline',
      size: 'large',
      text: 'continue_with',
      shape: 'pill',
      width: Math.min(340, Math.max(240, container.clientWidth || 300)),
      logo_alignment: 'left',
    });
    return true;
  } catch {
    return false;
  }
}
