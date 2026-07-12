(function exposeSettingsValidation(globalScope) {
  const DELETE_CONFIRMATION = 'DELETE';

  function normaliseDisplayName(value) {
    return String(value || '').trim().replace(/\s+/g, ' ');
  }

  function validateDisplayName(value) {
    const displayName = normaliseDisplayName(value);
    if (!displayName) return 'Enter a display name.';
    if (displayName.length > 50) return 'Display names must be 50 characters or fewer.';
    return '';
  }

  function normaliseEmail(value) {
    return String(value || '').trim();
  }

  function validateEmailChange(currentEmail, nextEmail) {
    const email = normaliseEmail(nextEmail);
    if (!email) return 'Enter your new email address.';
    if (email.toLocaleLowerCase() === normaliseEmail(currentEmail).toLocaleLowerCase()) {
      return 'That is already your account email.';
    }
    return '';
  }

  function validatePasswordChange(currentPassword, nextPassword, confirmation) {
    if (!currentPassword) return 'Enter your current password.';
    if (String(nextPassword || '').length < 8) return 'Use at least 8 characters for your new password.';
    if (nextPassword !== confirmation) return 'The new passwords do not match.';
    if (nextPassword === currentPassword) return 'Choose a new password that is different from your current password.';
    return '';
  }

  function canDeleteAccount(currentPassword, confirmation) {
    return Boolean(currentPassword) && confirmation === DELETE_CONFIRMATION;
  }

  const api = Object.freeze({
    DELETE_CONFIRMATION,
    normaliseDisplayName,
    normaliseEmail,
    validateDisplayName,
    validateEmailChange,
    validatePasswordChange,
    canDeleteAccount,
  });

  globalScope.SettingsValidation = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : window);
