(function initialisePasswordReset() {
  const service = window.DartsSupabase;
  const form = document.getElementById('reset-password-form');
  const password = document.getElementById('new-password');
  const confirmation = document.getElementById('confirm-password');
  const message = document.getElementById('reset-message');
  const submit = document.getElementById('reset-submit');
  let recoverySessionReady = false;

  function setMessage(text, kind = '') {
    message.textContent = text;
    message.dataset.kind = kind;
  }

  if (!service) {
    form.hidden = true;
    setMessage(window.DARTS_SUPABASE_ERROR || 'Account recovery is temporarily unavailable.', 'error');
    return;
  }

  function enableRecoverySession(session) {
    recoverySessionReady = Boolean(session);
    submit.disabled = !recoverySessionReady;
    if (recoverySessionReady) setMessage('Reset link verified. Choose your new password.', 'success');
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!recoverySessionReady) {
      setMessage('Open this page from a valid password-reset email before changing your password.', 'error');
      return;
    }
    if (password.value !== confirmation.value) {
      setMessage('The passwords do not match.', 'error');
      confirmation.focus();
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Updating password…';
    setMessage('');
    try {
      const result = await service.client.auth.updateUser({ password: password.value });
      if (result.error) throw result.error;
      form.reset();
      setMessage('Your password has been updated. You can return to Darts.', 'success');
      submit.hidden = true;
    } catch (error) {
      setMessage(error?.message || 'The password could not be updated. Request a fresh reset link and try again.', 'error');
    } finally {
      submit.disabled = false;
      if (!submit.hidden) submit.textContent = 'Update password';
    }
  });

  service.client.auth.onAuthStateChange((event, session) => {
    if (event === 'PASSWORD_RECOVERY') {
      window.setTimeout(() => enableRecoverySession(session), 0);
    }
    if (event === 'SIGNED_OUT') {
      recoverySessionReady = false;
      submit.disabled = true;
    }
  });

  service.client.auth.getSession().then(({ data, error }) => {
    if (error || !data.session) setMessage('This reset link is missing, invalid, or expired. Request a new link from the sign-in form.', 'error');
    else if (!recoverySessionReady) setMessage('Open the link from your password-reset email to continue.', 'error');
  });
})();
