const assert = require('node:assert/strict');
const validation = require('./settings-validation.js');

assert.equal(validation.normaliseDisplayName('  Joe   C  '), 'Joe C');
assert.equal(validation.validateDisplayName('   '), 'Enter a display name.');
assert.equal(validation.validateDisplayName('x'.repeat(51)), 'Display names must be 50 characters or fewer.');
assert.equal(validation.validateDisplayName('Joe'), '');

assert.equal(validation.normaliseEmail('  player@example.com '), 'player@example.com');
assert.equal(validation.validateEmailChange('player@example.com', ''), 'Enter your new email address.');
assert.equal(
  validation.validateEmailChange('Player@example.com', 'player@EXAMPLE.com'),
  'That is already your account email.',
);
assert.equal(validation.validateEmailChange('old@example.com', 'new@example.com'), '');

assert.equal(validation.validatePasswordChange('', 'new-password', 'new-password'), 'Enter your current password.');
assert.equal(
  validation.validatePasswordChange('old-password', 'short', 'short'),
  'Use at least 8 characters for your new password.',
);
assert.equal(
  validation.validatePasswordChange('old-password', 'new-password', 'different-password'),
  'The new passwords do not match.',
);
assert.equal(
  validation.validatePasswordChange('same-password', 'same-password', 'same-password'),
  'Choose a new password that is different from your current password.',
);
assert.equal(validation.validatePasswordChange('old-password', 'new-password', 'new-password'), '');

assert.equal(validation.canDeleteAccount('password', 'DELETE'), true);
assert.equal(validation.canDeleteAccount('', 'DELETE'), false);
assert.equal(validation.canDeleteAccount('password', 'delete'), false);

console.log('Settings validation tests passed.');
