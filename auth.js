(function initialiseHomeAuthentication() {
  const service = window.DartsSupabase;
  const dialog = document.getElementById('auth-dialog');
  const form = document.getElementById('auth-form');
  const signInTab = document.getElementById('sign-in-tab');
  const signUpTab = document.getElementById('sign-up-tab');
  const displayNameField = document.getElementById('display-name-field');
  const displayNameInput = document.getElementById('display-name');
  const emailInput = document.getElementById('auth-email');
  const passwordInput = document.getElementById('auth-password');
  const passwordHelp = document.getElementById('password-help');
  const submitButton = document.getElementById('auth-submit');
  const forgotPasswordButton = document.getElementById('forgot-password');
  const authMessage = document.getElementById('auth-message');
  const pageMessage = document.getElementById('page-message');
  const signedOutCard = document.getElementById('signed-out-card');
  const signedInCard = document.getElementById('signed-in-card');
  const accountNavName = document.getElementById('account-nav-name');
  const signedInEmail = document.getElementById('signed-in-email');
  const openSignInButton = document.getElementById('open-sign-in');
  const openSignUpButton = document.getElementById('open-sign-up');
  const signOutButton = document.getElementById('sign-out-button');

  let mode = 'sign-in';
  let renderVersion = 0;

  function setMessage(element, message, kind = '') {
    element.textContent = message;
    element.dataset.kind = kind;
  }

  function setMode(nextMode) {
    mode = nextMode;
    const signingUp = mode === 'sign-up';
    document.getElementById('auth-title').textContent = signingUp ? 'Create your account' : 'Sign in';
    signInTab.setAttribute('aria-selected', String(!signingUp));
    signUpTab.setAttribute('aria-selected', String(signingUp));
    displayNameField.hidden = !signingUp;
    displayNameInput.required = signingUp;
    passwordInput.autocomplete = signingUp ? 'new-password' : 'current-password';
    passwordInput.minLength = signingUp ? 8 : 1;
    passwordHelp.textContent = signingUp
      ? 'Use at least 8 characters.'
      : 'Use the password for your account.';
    submitButton.textContent = signingUp ? 'Create account' : 'Sign in';
    forgotPasswordButton.hidden = signingUp;
    setMessage(authMessage, '');
  }

  function openDialog(nextMode) {
    if (!service) {
      setMessage(pageMessage, window.DARTS_SUPABASE_ERROR || 'Accounts are temporarily unavailable.', 'error');
      return;
    }
    setMode(nextMode);
    if (typeof dialog.showModal === 'function') dialog.showModal();
    else dialog.setAttribute('open', '');
    window.setTimeout(() => (nextMode === 'sign-up' ? displayNameInput : emailInput).focus(), 0);
  }

  function closeDialog() {
    if (typeof dialog.close === 'function') dialog.close();
    else dialog.removeAttribute('open');
  }

  function setBusy(busy) {
    submitButton.disabled = busy;
    signInTab.disabled = busy;
    signUpTab.disabled = busy;
    forgotPasswordButton.disabled = busy;
    submitButton.textContent = busy
      ? (mode === 'sign-up' ? 'Creating account…' : 'Signing in…')
      : (mode === 'sign-up' ? 'Create account' : 'Sign in');
  }

  async function renderSession(session) {
    const version = ++renderVersion;
    const user = session?.user;
    const signedIn = Boolean(user);

    signedOutCard.hidden = signedIn;
    signedInCard.hidden = !signedIn;
    openSignInButton.hidden = signedIn;
    openSignUpButton.hidden = signedIn;
    accountNavName.hidden = !signedIn;
    signOutButton.hidden = !signedIn;

    if (!user) {
      accountNavName.textContent = '';
      signedInEmail.textContent = '';
      return;
    }

    let displayName = service.fallbackDisplayName(user);
    try {
      const profile = await service.getOrCreateProfile(user);
      displayName = profile?.display_name || displayName;
    } catch (error) {
      console.error('Unable to load profile', error);
    }

    if (version !== renderVersion) return;
    accountNavName.textContent = displayName;
    document.getElementById('welcome-title').textContent = `Welcome back, ${displayName}`;
    signedInEmail.textContent = user.email;
  }

  async function submitAuth(event) {
    event.preventDefault();
    if (!service) return;

    const email = emailInput.value.trim();
    const password = passwordInput.value;
    setBusy(true);
    setMessage(authMessage, '');

    try {
      if (mode === 'sign-up') {
        const displayName = displayNameInput.value.trim();
        if (!displayName) {
          setMessage(authMessage, 'Enter a display name.', 'error');
          displayNameInput.focus();
          return;
        }
        const result = await service.client.auth.signUp({
          email,
          password,
          options: {
            emailRedirectTo: new URL('./', window.location.href).href,
            data: { display_name: displayName },
          },
        });
        if (result.error) throw result.error;

        if (result.data.session) {
          await renderSession(result.data.session);
          closeDialog();
          setMessage(pageMessage, 'Your account is ready and you are signed in.', 'success');
        } else {
          form.reset();
          setMessage(authMessage, 'Check your inbox and confirm your email address to finish creating the account.', 'success');
        }
      } else {
        const result = await service.client.auth.signInWithPassword({ email, password });
        if (result.error) throw result.error;
        form.reset();
        await renderSession(result.data.session);
        closeDialog();
        setMessage(pageMessage, 'You are signed in.', 'success');
      }
    } catch (error) {
      setMessage(authMessage, error?.message || 'Something went wrong. Please try again.', 'error');
    } finally {
      setBusy(false);
    }
  }

  async function sendPasswordReset() {
    const email = emailInput.value.trim();
    if (!email) {
      setMessage(authMessage, 'Enter your email address first.', 'error');
      emailInput.focus();
      return;
    }

    setBusy(true);
    try {
      const redirectTo = new URL('reset-password.html', window.location.href).href;
      const result = await service.client.auth.resetPasswordForEmail(email, { redirectTo });
      if (result.error) throw result.error;
      setMessage(authMessage, 'If an account exists for that email, a password-reset link is on its way.', 'success');
    } catch (error) {
      setMessage(authMessage, error?.message || 'Unable to send the reset email.', 'error');
    } finally {
      setBusy(false);
    }
  }

  document.getElementById('close-auth-dialog').addEventListener('click', closeDialog);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) closeDialog();
  });
  signInTab.addEventListener('click', () => setMode('sign-in'));
  signUpTab.addEventListener('click', () => setMode('sign-up'));
  form.addEventListener('submit', submitAuth);
  forgotPasswordButton.addEventListener('click', sendPasswordReset);
  openSignInButton.addEventListener('click', () => openDialog('sign-in'));
  openSignUpButton.addEventListener('click', () => openDialog('sign-up'));
  document.getElementById('card-sign-in').addEventListener('click', () => openDialog('sign-in'));
  document.getElementById('card-sign-up').addEventListener('click', () => openDialog('sign-up'));

  signOutButton.addEventListener('click', async () => {
    if (!service) return;
    signOutButton.disabled = true;
    const result = await service.client.auth.signOut({ scope: 'local' });
    signOutButton.disabled = false;
    if (result.error) {
      setMessage(pageMessage, result.error.message, 'error');
      return;
    }
    await renderSession(null);
    setMessage(pageMessage, 'You are signed out. Guest play is still available.', 'success');
  });

  if (!service) {
    setMessage(pageMessage, window.DARTS_SUPABASE_ERROR || 'Accounts are temporarily unavailable. Guest play still works.', 'error');
    return;
  }

  service.client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => renderSession(session), 0);
  });

  service.client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return renderSession(data.session);
    })
    .catch((error) => {
      console.error('Unable to restore session', error);
      setMessage(pageMessage, 'Your account session could not be restored. Guest play still works.', 'error');
    });
})();
