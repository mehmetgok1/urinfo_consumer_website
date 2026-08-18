const requiredEnv = [
  'VITE_AWS_REGION',
  'VITE_COGNITO_USER_POOL_ID',
  'VITE_COGNITO_USER_POOL_CLIENT_ID'
];

for (const envKey of requiredEnv) {
  if (!import.meta.env[envKey]) {
    // This warning helps catch missing setup early in development.
    // The app can still render the login UI, but auth operations will fail.
    // eslint-disable-next-line no-console
    console.warn(`Missing environment variable: ${envKey}`);
  }
}

export const amplifyConfig = {
  Auth: {
    Cognito: {
      userPoolId: import.meta.env.VITE_COGNITO_USER_POOL_ID,
      userPoolClientId: import.meta.env.VITE_COGNITO_USER_POOL_CLIENT_ID,
      signUpVerificationMethod: 'code',
      loginWith: {
        email: true
      }
    }
  }
};
