const EMAIL_CHANGE_FLOW_KEY = 'ethio_pending_email_change_v1';
const FORGOT_PW_FLOW_KEY = 'ethio_pending_forgot_pw_v1';
const SIGNUP_FLOW_KEY = 'ethio_pending_signup_v1';
const FLOW_TTL_MS = 12 * 60 * 1000;

export interface PendingEmailChangeFlow {
  uid: string;
  oldEmail: string;
  newEmail: string;
  emailCodeSentFor: string;
  verifiedEmailChange: { forEmail: string; token: string } | null;
  expiresAt: number;
}

export interface PendingForgotPwFlow {
  forgotStep: 'code' | 'new_password';
  email: string;
  resetToken: string;
  expiresAt: number;
}

export interface PendingSignupFlow {
  signupStep: 'code';
  username: string;
  displayName: string;
  email: string;
  expiresAt: number;
}

export function savePendingEmailChangeFlow(
  data: Omit<PendingEmailChangeFlow, 'expiresAt'>
): void {
  try {
    const payload: PendingEmailChangeFlow = {
      ...data,
      expiresAt: Date.now() + FLOW_TTL_MS,
    };
    localStorage.setItem(EMAIL_CHANGE_FLOW_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage errors
  }
}

export function readPendingEmailChangeFlow(
  uid?: string | null,
  currentEmail?: string | null
): PendingEmailChangeFlow | null {
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(EMAIL_CHANGE_FLOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingEmailChangeFlow;
    if (!parsed || parsed.uid !== uid || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
      localStorage.removeItem(EMAIL_CHANGE_FLOW_KEY);
      return null;
    }
    if (
      currentEmail &&
      parsed.oldEmail &&
      currentEmail.trim().toLowerCase() !== parsed.oldEmail.trim().toLowerCase()
    ) {
      localStorage.removeItem(EMAIL_CHANGE_FLOW_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingEmailChangeFlow(): void {
  try {
    localStorage.removeItem(EMAIL_CHANGE_FLOW_KEY);
  } catch {
    // ignore
  }
}

export function savePendingForgotPwFlow(
  data: Omit<PendingForgotPwFlow, 'expiresAt'>
): void {
  try {
    const payload: PendingForgotPwFlow = {
      ...data,
      expiresAt: Date.now() + FLOW_TTL_MS,
    };
    localStorage.setItem(FORGOT_PW_FLOW_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function readPendingForgotPwFlow(): PendingForgotPwFlow | null {
  try {
    const raw = localStorage.getItem(FORGOT_PW_FLOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingForgotPwFlow;
    if (!parsed || !parsed.email || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
      localStorage.removeItem(FORGOT_PW_FLOW_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingForgotPwFlow(): void {
  try {
    localStorage.removeItem(FORGOT_PW_FLOW_KEY);
  } catch {
    // ignore
  }
}

export function savePendingSignupFlow(
  data: Omit<PendingSignupFlow, 'expiresAt'>
): void {
  try {
    const payload: PendingSignupFlow = {
      ...data,
      expiresAt: Date.now() + FLOW_TTL_MS,
    };
    localStorage.setItem(SIGNUP_FLOW_KEY, JSON.stringify(payload));
  } catch {
    // ignore
  }
}

export function readPendingSignupFlow(): PendingSignupFlow | null {
  try {
    const raw = localStorage.getItem(SIGNUP_FLOW_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingSignupFlow;
    if (!parsed || !parsed.email || !parsed.expiresAt || Date.now() > parsed.expiresAt) {
      localStorage.removeItem(SIGNUP_FLOW_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function clearPendingSignupFlow(): void {
  try {
    localStorage.removeItem(SIGNUP_FLOW_KEY);
  } catch {
    // ignore
  }
}
