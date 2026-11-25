export interface PasswordStrengthChecks {
  minLength: boolean;
  hasUppercase: boolean;
  hasLowercase: boolean;
  hasNumber: boolean;
  hasSymbol: boolean;
  isValid: boolean;
}

export function evaluatePasswordStrength(password: string): PasswordStrengthChecks {
  const minLength = password.length >= 8;
  const hasUppercase = /[A-Z]/.test(password);
  const hasLowercase = /[a-z]/.test(password);
  const hasNumber = /[0-9]/.test(password);
  const hasSymbol = /[^A-Za-z0-9]/.test(password);
  return {
    minLength,
    hasUppercase,
    hasLowercase,
    hasNumber,
    hasSymbol,
    isValid: minLength && hasUppercase && hasLowercase && hasNumber && hasSymbol,
  };
}

export function validateStrongPassword(password: string): {
  valid: boolean;
  error?: string;
  checks: PasswordStrengthChecks;
} {
  const checks = evaluatePasswordStrength(password);
  if (checks.isValid) {
    return { valid: true, checks };
  }

  const missing: string[] = [];
  if (!checks.minLength) missing.push('at least 8 characters');
  if (!checks.hasUppercase) missing.push('an uppercase letter (A-Z)');
  if (!checks.hasLowercase) missing.push('a lowercase letter (a-z)');
  if (!checks.hasNumber) missing.push('a number (0-9)');
  if (!checks.hasSymbol) missing.push('a symbol (!@#$%...)');

  return {
    valid: false,
    error: `Password must include ${missing.join(', ')}.`,
    checks,
  };
}
