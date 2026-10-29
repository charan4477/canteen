// Customer email auth with Amazon Cognito, using plain fetch (no SDK needed).
const Auth = (() => {
  const { COGNITO_REGION, COGNITO_CLIENT_ID } = window.CANTEEN_CONFIG;
  const ENDPOINT = `https://cognito-idp.${COGNITO_REGION}.amazonaws.com/`;
  const STORE = "canteen.session";

  async function call(action, body) {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-amz-json-1.1",
        "X-Amz-Target": `AWSCognitoIdentityProviderService.${action}`,
      },
      body: JSON.stringify({ ClientId: COGNITO_CLIENT_ID, ...body }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const type = (data.__type || "").split("#").pop();
      const friendly = {
        UsernameExistsException: "An account with this email already exists. Try signing in.",
        UserNotConfirmedException: "Please verify your email first.",
        NotAuthorizedException: "Wrong email or password.",
        CodeMismatchException: "That code is not right. Check your email again.",
        ExpiredCodeException: "That code expired. Send a new one.",
        InvalidPasswordException: "Password needs 8+ characters with a lowercase letter and a number.",
        LimitExceededException: "Too many attempts. Wait a few minutes.",
      };
      const err = new Error(friendly[type] || data.message || "Something went wrong");
      err.type = type;
      throw err;
    }
    return data;
  }

  function decode(jwt) {
    const part = jwt.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    return JSON.parse(decodeURIComponent(escape(atob(part))));
  }

  function save(result, refreshToken) {
    const s = {
      idToken: result.IdToken,
      refreshToken: result.RefreshToken || refreshToken,
      expiresAt: Date.now() + (result.ExpiresIn - 60) * 1000,
    };
    localStorage.setItem(STORE, JSON.stringify(s));
    return s;
  }

  return {
    signUp: (email, password, name) =>
      call("SignUp", {
        Username: email, Password: password,
        UserAttributes: [{ Name: "email", Value: email }, { Name: "name", Value: name }],
      }),
    confirm: (email, code) => call("ConfirmSignUp", { Username: email, ConfirmationCode: code }),
    resend: (email) => call("ResendConfirmationCode", { Username: email }),
    forgot: (email) => call("ForgotPassword", { Username: email }),
    resetPassword: (email, code, password) =>
      call("ConfirmForgotPassword", { Username: email, ConfirmationCode: code, Password: password }),

    async signIn(email, password) {
      const r = await call("InitiateAuth", {
        AuthFlow: "USER_PASSWORD_AUTH",
        AuthParameters: { USERNAME: email, PASSWORD: password },
      });
      return save(r.AuthenticationResult);
    },

    // Returns a valid ID token (refreshing it if needed), or null if signed out.
    async token() {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!s) return null;
      if (Date.now() < s.expiresAt) return s.idToken;
      try {
        const r = await call("InitiateAuth", {
          AuthFlow: "REFRESH_TOKEN_AUTH",
          AuthParameters: { REFRESH_TOKEN: s.refreshToken },
        });
        return save(r.AuthenticationResult, s.refreshToken).idToken;
      } catch {
        localStorage.removeItem(STORE);
        return null;
      }
    },

    user() {
      const s = JSON.parse(localStorage.getItem(STORE) || "null");
      if (!s) return null;
      const c = decode(s.idToken);
      return { email: c.email, name: c.name || c.email };
    },

    signOut() { localStorage.removeItem(STORE); },
  };
})();
