(function initialiseAccountSettings() {
  const service = window.DartsSupabase;
  const validation = window.SettingsValidation;
  const pageMessage = document.getElementById('settings-message');
  const signedOutState = document.getElementById('signed-out-settings');
  const unavailableState = document.getElementById('unavailable-settings');
  const content = document.getElementById('settings-content');
  const accountName = document.getElementById('settings-account-name');
  const signOutButton = document.getElementById('settings-sign-out');

  const displayNameForm = document.getElementById('display-name-form');
  const displayNameInput = document.getElementById('settings-display-name');
  const displayNameSubmit = document.getElementById('display-name-submit');
  const displayNameMessage = document.getElementById('display-name-message');

  const emailForm = document.getElementById('email-form');
  const currentEmailValue = document.getElementById('settings-current-email');
  const newEmailInput = document.getElementById('settings-new-email');
  const emailSubmit = document.getElementById('email-submit');
  const emailMessage = document.getElementById('email-message');

  const passwordForm = document.getElementById('password-form');
  const currentPasswordInput = document.getElementById('settings-current-password');
  const newPasswordInput = document.getElementById('settings-new-password');
  const confirmPasswordInput = document.getElementById('settings-confirm-password');
  const passwordSubmit = document.getElementById('password-submit');
  const passwordMessage = document.getElementById('password-message');

  const deleteDialog = document.getElementById('delete-account-dialog');
  const deleteForm = document.getElementById('delete-account-form');
  const deletePasswordInput = document.getElementById('delete-account-password');
  const deleteConfirmationInput = document.getElementById('delete-account-confirmation');
  const deleteMessage = document.getElementById('delete-account-message');
  const cancelDeleteButton = document.getElementById('cancel-delete-account');
  const confirmDeleteButton = document.getElementById('confirm-delete-account');

  let currentUser = null;
  let loadVersion = 0;
  let deleteInProgress = false;
  let deletionFinished = false;
  const accountDeletionMarker = 'darts-account-deleted';

  function setMessage(element, text, kind = '') {
    element.textContent = text;
    element.dataset.kind = kind;
  }

  function setFormBusy(form, submit, busy, busyLabel, readyLabel) {
    Array.from(form.elements).forEach((control) => {
      control.disabled = busy;
    });
    submit.textContent = busy ? busyLabel : readyLabel;
  }

  function friendlyAuthError(error, fallback) {
    switch (error?.code) {
      case 'invalid_credentials':
        return 'Your current password is incorrect.';
      case 'email_exists':
      case 'user_already_exists':
        return 'That email address is already connected to an account.';
      case 'same_password':
        return 'Choose a new password that is different from your current password.';
      case 'weak_password':
        return error.message || 'That password does not meet the account security requirements.';
      case 'reauthentication_needed':
        return 'For security, sign out and sign back in before changing your password.';
      case 'over_email_send_rate_limit':
        return 'Too many email requests were made. Wait a little while and try again.';
      default:
        return error?.message || fallback;
    }
  }

  function clearPrivateForms() {
    passwordForm.reset();
    deleteForm.reset();
    setMessage(passwordMessage, '');
    setMessage(deleteMessage, '');
    updateDeleteButton();
  }

  async function loadSettings(session) {
    const version = ++loadVersion;
    const previousUserId = currentUser?.id || null;
    currentUser = session?.user || null;
    const signedIn = Boolean(currentUser);

    signedOutState.hidden = signedIn;
    unavailableState.hidden = true;
    content.hidden = !signedIn;
    signOutButton.hidden = !signedIn;

    if (!currentUser) {
      accountName.textContent = '';
      currentEmailValue.textContent = '';
      displayNameForm.reset();
      emailForm.reset();
      clearPrivateForms();
      if ((deleteDialog.open || deleteDialog.hasAttribute('open')) && !deleteInProgress) closeDeleteDialog();
      setMessage(pageMessage, '');
      return;
    }

    const userId = currentUser.id;
    const sameUser = previousUserId === userId;
    const fallbackName = service.fallbackDisplayName(currentUser);
    accountName.textContent = fallbackName;
    currentEmailValue.textContent = currentUser.email || 'No confirmed email';
    if (!sameUser || document.activeElement !== displayNameInput) displayNameInput.value = fallbackName;
    setMessage(pageMessage, 'Loading your account settings…');

    try {
      const profile = await service.getOrCreateProfile(currentUser);
      if (version !== loadVersion || currentUser?.id !== userId) return;
      const profileName = profile?.display_name || fallbackName;
      accountName.textContent = profileName;
      if (document.activeElement !== displayNameInput) displayNameInput.value = profileName;
      setMessage(pageMessage, '');
    } catch (error) {
      if (version !== loadVersion || currentUser?.id !== userId) return;
      console.error('Unable to load account settings', error);
      setMessage(pageMessage, error?.message || 'Some account settings could not be loaded.', 'error');
    }
  }

  displayNameForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return;

    const errorMessage = validation.validateDisplayName(displayNameInput.value);
    if (errorMessage) {
      setMessage(displayNameMessage, errorMessage, 'error');
      displayNameInput.focus();
      return;
    }

    const userId = currentUser.id;
    const displayName = validation.normaliseDisplayName(displayNameInput.value);
    setFormBusy(displayNameForm, displayNameSubmit, true, 'Saving…', 'Save display name');
    setMessage(displayNameMessage, '');

    try {
      const profileResult = await service.client
        .from('profiles')
        .upsert({ id: userId, display_name: displayName, updated_at: new Date().toISOString() })
        .select('display_name')
        .single();
      if (profileResult.error) throw profileResult.error;
      if (currentUser?.id !== userId) return;

      displayNameInput.value = profileResult.data.display_name;
      accountName.textContent = profileResult.data.display_name;

      const metadataResult = await service.client.auth.updateUser({
        data: { display_name: profileResult.data.display_name },
      });
      if (metadataResult.error) {
        console.warn('Display name metadata could not be synchronised', metadataResult.error);
      } else if (metadataResult.data.user && currentUser?.id === userId) {
        currentUser = metadataResult.data.user;
      }

      setMessage(displayNameMessage, 'Your display name has been updated.', 'success');
    } catch (error) {
      if (currentUser?.id === userId) {
        setMessage(displayNameMessage, error?.message || 'Your display name could not be updated.', 'error');
      }
    } finally {
      setFormBusy(displayNameForm, displayNameSubmit, false, '', 'Save display name');
    }
  });

  emailForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return;

    const nextEmail = validation.normaliseEmail(newEmailInput.value);
    const errorMessage = validation.validateEmailChange(currentUser.email, nextEmail);
    if (errorMessage) {
      setMessage(emailMessage, errorMessage, 'error');
      newEmailInput.focus();
      return;
    }

    const userId = currentUser.id;
    const previousEmail = currentUser.email || '';
    setFormBusy(emailForm, emailSubmit, true, 'Sending…', 'Send confirmation');
    setMessage(emailMessage, '');

    try {
      const result = await service.client.auth.updateUser(
        { email: nextEmail },
        { emailRedirectTo: new URL('./', window.location.href).href },
      );
      if (result.error) throw result.error;
      if (currentUser?.id !== userId) return;

      if (result.data.user) currentUser = result.data.user;
      const confirmedEmail = result.data.user?.email || previousEmail;
      currentEmailValue.textContent = confirmedEmail;
      emailForm.reset();

      if (confirmedEmail.toLocaleLowerCase() === nextEmail.toLocaleLowerCase()) {
        setMessage(emailMessage, 'Your email address has been updated.', 'success');
      } else {
        setMessage(
          emailMessage,
          'Confirmation requested. Check both your current and new inboxes. Your sign-in email changes after both links are opened.',
          'success',
        );
      }
    } catch (error) {
      if (currentUser?.id === userId) {
        setMessage(emailMessage, friendlyAuthError(error, 'The email change could not be started.'), 'error');
      }
    } finally {
      setFormBusy(emailForm, emailSubmit, false, '', 'Send confirmation');
    }
  });

  passwordForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser) return;

    const errorMessage = validation.validatePasswordChange(
      currentPasswordInput.value,
      newPasswordInput.value,
      confirmPasswordInput.value,
    );
    if (errorMessage) {
      setMessage(passwordMessage, errorMessage, 'error');
      return;
    }

    const userId = currentUser.id;
    const email = currentUser.email;
    const currentPassword = currentPasswordInput.value;
    const nextPassword = newPasswordInput.value;
    if (!email) {
      setMessage(passwordMessage, 'This account does not have an email address that can be verified.', 'error');
      return;
    }
    setFormBusy(passwordForm, passwordSubmit, true, 'Updating…', 'Update password');
    setMessage(passwordMessage, '');

    try {
      const signInResult = await service.client.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInResult.error) throw signInResult.error;
      if (signInResult.data.user?.id !== userId) throw new Error('The signed-in account changed. Please try again.');

      const result = await service.client.auth.updateUser({
        password: nextPassword,
        currentPassword,
      });
      if (result.error) throw result.error;
      if (currentUser?.id !== userId) return;
      if (result.data.user) currentUser = result.data.user;
      passwordForm.reset();
      setMessage(passwordMessage, 'Your password has been updated.', 'success');
    } catch (error) {
      currentPasswordInput.value = '';
      if (currentUser?.id === userId) {
        setMessage(passwordMessage, friendlyAuthError(error, 'Your password could not be updated.'), 'error');
      }
    } finally {
      setFormBusy(passwordForm, passwordSubmit, false, '', 'Update password');
    }
  });

  function updateDeleteButton() {
    confirmDeleteButton.disabled = deleteInProgress || !validation?.canDeleteAccount(
      deletePasswordInput.value,
      deleteConfirmationInput.value,
    );
  }

  function openDeleteDialog() {
    if (!currentUser || deleteInProgress) return;
    deleteForm.reset();
    setMessage(deleteMessage, '');
    updateDeleteButton();
    if (typeof deleteDialog.showModal === 'function') deleteDialog.showModal();
    else deleteDialog.setAttribute('open', '');
    window.setTimeout(() => cancelDeleteButton.focus(), 0);
  }

  function closeDeleteDialog() {
    if (deleteInProgress) return;
    deleteForm.reset();
    setMessage(deleteMessage, '');
    updateDeleteButton();
    if (typeof deleteDialog.close === 'function') deleteDialog.close();
    else deleteDialog.removeAttribute('open');
  }

  function setDeleteBusy(busy) {
    deleteInProgress = busy;
    deleteDialog.setAttribute('aria-busy', String(busy));
    deletePasswordInput.disabled = busy;
    deleteConfirmationInput.disabled = busy;
    cancelDeleteButton.disabled = busy;
    confirmDeleteButton.textContent = busy ? 'Deleting…' : 'Delete permanently';
    updateDeleteButton();
  }

  async function deletionErrorMessage(error) {
    const response = error?.context;
    let responseBody = null;
    try {
      if (response?.clone) responseBody = await response.clone().json();
    } catch (_error) {
      responseBody = null;
    }

    if (response?.status === 404) {
      return 'Account deletion is not available yet. Deploy the delete-account Edge Function in Supabase and try again.';
    }
    if (responseBody?.error) return responseBody.error;
    if (!response) {
      return 'The deletion outcome could not be confirmed. Check your connection and try again.';
    }
    return error?.message || 'Your account could not be deleted.';
  }

  async function invokeAccountDeletion() {
    const invoke = () => service.client.functions.invoke('delete-account', {
      body: { confirmation: validation.DELETE_CONFIRMATION },
    });

    const firstResult = await invoke();
    if (!firstResult.error) return firstResult;

    // A response can be lost after the server has already deleted the user.
    // Retry with the same still-valid JWT so the function can confirm that the
    // caller's own account no longer exists without requiring another sign-in.
    const retryResult = await invoke();
    if (!retryResult.error) return retryResult;

    const userCheck = await service.client.auth.getUser();
    if (userCheck.error?.code === 'user_not_found') {
      return { data: { deleted: true }, error: null };
    }

    const message = await deletionErrorMessage(retryResult.error || firstResult.error);
    const functionError = new Error(message);
    functionError.isFriendly = true;
    throw functionError;
  }

  deletePasswordInput.addEventListener('input', updateDeleteButton);
  deleteConfirmationInput.addEventListener('input', updateDeleteButton);
  document.getElementById('open-delete-account').addEventListener('click', openDeleteDialog);
  cancelDeleteButton.addEventListener('click', closeDeleteDialog);
  deleteDialog.addEventListener('cancel', (event) => {
    event.preventDefault();
    closeDeleteDialog();
  });
  deleteDialog.addEventListener('click', (event) => {
    if (event.target === deleteDialog) closeDeleteDialog();
  });

  deleteForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!currentUser || deleteInProgress) return;
    if (!validation.canDeleteAccount(deletePasswordInput.value, deleteConfirmationInput.value)) {
      setMessage(deleteMessage, 'Enter your password and type DELETE exactly as shown.', 'error');
      updateDeleteButton();
      return;
    }

    const userId = currentUser.id;
    const email = currentUser.email;
    const currentPassword = deletePasswordInput.value;
    if (!email) {
      setMessage(deleteMessage, 'This account does not have an email address that can be verified.', 'error');
      return;
    }

    setDeleteBusy(true);
    deletionFinished = false;
    setMessage(deleteMessage, 'Verifying your password…');
    let deletionCompleted = false;

    try {
      const signInResult = await service.client.auth.signInWithPassword({
        email,
        password: currentPassword,
      });
      if (signInResult.error) throw signInResult.error;
      if (signInResult.data.user?.id !== userId) throw new Error('The signed-in account changed. Please try again.');

      setMessage(deleteMessage, 'Deleting your account and saved data…');
      const result = await invokeAccountDeletion();
      if (result.data?.deleted !== true) throw new Error('Supabase did not confirm that the account was deleted.');

      deletionCompleted = true;
      deleteForm.reset();
      try {
        const signOutResult = await service.client.auth.signOut({ scope: 'local' });
        if (signOutResult.error) console.warn('The deleted account session could not be cleared cleanly', signOutResult.error);
      } catch (signOutError) {
        console.warn('The deleted account session could not be cleared cleanly', signOutError);
      }
      try {
        window.sessionStorage.setItem(accountDeletionMarker, '1');
      } catch (storageError) {
        console.warn('The account deletion notice could not be saved', storageError);
      }
      deletionFinished = true;
      window.location.replace('../');
    } catch (error) {
      deletePasswordInput.value = '';
      setMessage(
        deleteMessage,
        error?.isFriendly ? error.message : friendlyAuthError(error, 'Your account could not be deleted.'),
        'error',
      );
    } finally {
      if (!deletionCompleted) {
        deletionFinished = false;
        setDeleteBusy(false);
        if (!currentUser) {
          closeDeleteDialog();
          setMessage(pageMessage, 'Your session ended before account deletion could be confirmed.', 'error');
        }
      }
    }
  });

  window.addEventListener('beforeunload', (event) => {
    if (!deleteInProgress || deletionFinished) return;
    event.preventDefault();
    event.returnValue = '';
  });

  if (!service || !validation) {
    signedOutState.hidden = true;
    unavailableState.hidden = false;
    content.hidden = true;
    setMessage(pageMessage, window.DARTS_SUPABASE_ERROR || 'Account settings could not be loaded.', 'error');
    return;
  }

  signOutButton.addEventListener('click', async () => {
    signOutButton.disabled = true;
    const result = await service.client.auth.signOut({ scope: 'local' });
    if (result.error) {
      setMessage(pageMessage, result.error.message, 'error');
      signOutButton.disabled = false;
      return;
    }
    window.location.replace('../');
  });

  service.client.auth.onAuthStateChange((_event, session) => {
    window.setTimeout(() => loadSettings(session), 0);
  });

  service.client.auth.getSession()
    .then(({ data, error }) => {
      if (error) throw error;
      return loadSettings(data.session);
    })
    .catch((error) => setMessage(pageMessage, error.message, 'error'));
})();
