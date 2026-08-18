import { useEffect, useMemo, useRef, useState } from 'react';
import {
  confirmSignUp,
  fetchAuthSession,
  signIn,
  signOut,
  signUp
} from 'aws-amplify/auth';
import { Button, Heading, View } from '@aws-amplify/ui-react';
import '@aws-amplify/ui-react/styles.css';
import { QRCodeSVG } from 'qrcode.react';
import { Html5Qrcode, Html5QrcodeSupportedFormats, Html5QrcodeScanner } from 'html5-qrcode';
import { BrowserRouter, Navigate, Route, Routes, useNavigate } from 'react-router-dom';

const COACH_GROUP = 'coaches';
const USERS_GROUP = 'users';

function parseScannedUserId(rawText) {
  const text = String(rawText || '').trim();
  if (!text) {
    return null;
  }

  try {
    const parsed = JSON.parse(text);
    if (typeof parsed?.UserId === 'string' && parsed.UserId.trim()) {
      return parsed.UserId.trim();
    }
    if (typeof parsed?.sub === 'string' && parsed.sub.trim()) {
      return parsed.sub.trim();
    }
  } catch {
    // Fallback to raw text if it is not JSON.
  }

  return text;
}

function getRoleFromToken(payload = {}) {
  const groupsClaim = payload['cognito:groups'];
  const groups = Array.isArray(groupsClaim)
    ? groupsClaim
    : typeof groupsClaim === 'string'
      ? [groupsClaim]
      : [];

  if (groups.includes(COACH_GROUP)) {
    return 'coach';
  }

  const customRole = String(payload['custom:role'] || payload['custom:userType'] || '').toLowerCase();
  if (customRole === 'coach' || customRole === 'coaches') {
    return 'coach';
  }

  if (customRole === 'patient' || customRole === 'user' || customRole === 'users') {
    return 'patient';
  }

  return 'patient';
}

function PatientDashboard({ userSub, signOut }) {
  const qrPayload = useMemo(() => JSON.stringify({ UserId: userSub }), [userSub]);

  return (
    <main className="app-shell">
      <header className="app-header">
        <Heading level={2}>Patient Dashboard</Heading>
        <Button onClick={signOut} variation="link">
          Sign Out
        </Button>
      </header>

      <section className="card">
        <Heading level={3}>Your QR code</Heading>
        <p className="muted">Show this QR to your coach so they can link you to their profile.</p>
        <div className="qr-wrap">
          <QRCodeSVG value={qrPayload} size={320} includeMargin />
        </div>
        <p className="id-label">User ID</p>
        <p className="id-value">{userSub}</p>
      </section>
    </main>
  );
}

function CoachDashboard({ coachSub, accessToken, signOut }) {
  const scannerRegionId = 'coach-qr-scanner';
  const scannerRef = useRef(null);
  const [scannedUserId, setScannedUserId] = useState('');
  const [linkStatus, setLinkStatus] = useState('');
  const [isLinking, setIsLinking] = useState(false);
  const [patients, setPatients] = useState([]);
  const [cameraError, setCameraError] = useState('');

  function applyScannedValue(rawText) {
    const parsedUserId = parseScannedUserId(rawText);
    if (parsedUserId) {
      setScannedUserId(parsedUserId);
      setLinkStatus('QR code scanned. Ready to add patient.');
      return true;
    }

    setLinkStatus('Scanned QR code did not contain a valid user id.');
    return false;
  }

  useEffect(() => {
    if (scannerRef.current) {
      return undefined;
    }

    const scanner = new Html5QrcodeScanner(
      scannerRegionId,
      {
        fps: 10,
        qrbox: { width: 260, height: 260 },
        rememberLastUsedCamera: true,
        showTorchButtonIfSupported: true,
        disableFlip: false,
        formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
      },
      false
    );

    scanner.render(
      (decodedText) => {
        applyScannedValue(decodedText);
      },
      (errorMessage) => {
        setCameraError(errorMessage || 'Camera is running but no QR detected yet.');
      }
    );

    scannerRef.current = scanner;

    return () => {
      if (scannerRef.current) {
        scannerRef.current
          .clear()
          .catch(() => {})
          .finally(() => {
            scannerRef.current = null;
          });
      }
    };
  }, []);

  async function handleImageUpload(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    const html5QrCode = new Html5Qrcode(scannerRegionId);
    try {
      const decodedText = await html5QrCode.scanFile(file, true);
      applyScannedValue(decodedText);
    } catch (error) {
      setLinkStatus(`Unable to read QR from uploaded file: ${error.message || 'Unknown error'}`);
    } finally {
      event.target.value = '';
      if (scannerRef.current) {
        scannerRef.current.resume();
      }
    }
  }

  function handleDemoScan() {
    const demoUserId = 'demo-patient-user-123';
    setScannedUserId(demoUserId);
    setLinkStatus('Demo QR loaded. This simulates a scanned patient id.');
  }

  function handleAddPatient() {
    if (!scannedUserId) {
      setLinkStatus('Scan a patient QR code first.');
      return;
    }

    setPatients((current) => {
      if (current.some((item) => item.id === scannedUserId)) {
        return current;
      }

      return [...current, { id: scannedUserId, label: `Patient ${current.length + 1}` }];
    });

    setLinkStatus('Patient added to this coach profile.');
  }

  async function handleBindPatient() {
    if (!scannedUserId) {
      setLinkStatus('Scan a patient QR code first.');
      return;
    }
    if (!coachSub || !accessToken) {
      setLinkStatus('Missing auth context. Please sign out and sign in again.');
      return;
    }

    const apiUrl = import.meta.env.VITE_COACH_LINK_API_URL;
    if (!apiUrl) {
      setLinkStatus('Missing VITE_COACH_LINK_API_URL in .env.');
      return;
    }

    setIsLinking(true);
    setLinkStatus('Binding patient...');

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          CoachId: coachSub,
          UserId: scannedUserId
        })
      });

      const rawBody = await response.text();
      if (!response.ok) {
        setLinkStatus(`Link failed (${response.status}): ${rawBody || 'Unknown error'}`);
        return;
      }

      handleAddPatient();
      setLinkStatus(`Binding successful: ${rawBody || 'Patient bound.'}`);
    } catch (error) {
      setLinkStatus(`Request error: ${error.message}`);
    } finally {
      setIsLinking(false);
    }
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <Heading level={2}>Coach Dashboard</Heading>
        <Button onClick={signOut} variation="link">
          Sign Out
        </Button>
      </header>

      <section className="card">
        <p className="muted">Coach profile and patient management.</p>
        <div className="coach-meta">
          <p className="id-label">Coach ID</p>
          <p className="id-value">{coachSub}</p>
        </div>

        <div id={scannerRegionId} className="scanner-box" />

        {cameraError && <p className="status-text error-text">{cameraError}</p>}

        <div className="scan-result">
          <p className="id-label">Scanned patient ID</p>
          <p className="id-value">{scannedUserId || 'No patient scanned yet'}</p>
        </div>

        <div className="button-row">
          <Button variation="primary" onClick={handleAddPatient} isDisabled={!scannedUserId}>
            Add patient
          </Button>
          <Button variation="default" onClick={handleBindPatient} isLoading={isLinking} isDisabled={!scannedUserId || isLinking}>
            Bind patient
          </Button>
        </div>

        <div className="button-row secondary-row">
          <label className="file-input-label">
            Upload QR image
            <input type="file" accept="image/*" onChange={handleImageUpload} />
          </label>
          <Button variation="link" onClick={handleDemoScan}>
            Use demo QR
          </Button>
        </div>

        {linkStatus && <p className="status-text">{linkStatus}</p>}
      </section>

      <section className="card card-space">
        <Heading level={3}>Patients</Heading>
        {patients.length === 0 ? (
          <p className="muted">No linked patients yet.</p>
        ) : (
          <ul className="patient-list">
            {patients.map((patient) => (
              <li key={patient.id}>
                <span>{patient.label}</span>
                <code>{patient.id}</code>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}

function RoleDashboard({ signOut }) {
  const [isLoading, setIsLoading] = useState(true);
  const [role, setRole] = useState('patient');
  const [userSub, setUserSub] = useState('');
  const [accessToken, setAccessToken] = useState('');
  const [error, setError] = useState('');
  const navigate = useNavigate();

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await fetchAuthSession();
        const idTokenPayload = session.tokens?.idToken?.payload || {};
        const currentRole = getRoleFromToken(idTokenPayload);
        const sub = typeof idTokenPayload.sub === 'string' ? idTokenPayload.sub : '';
        const access = session.tokens?.accessToken?.toString() || '';

        setRole(currentRole);
        setUserSub(sub);
        setAccessToken(access);
        navigate(currentRole === 'coach' ? '/coach' : '/patient', { replace: true });
      } catch (sessionError) {
        setError(`Unable to load session: ${sessionError.message}`);
      } finally {
        setIsLoading(false);
      }
    }

    loadSession();
  }, [navigate]);

  if (isLoading) {
    return <p className="muted">Loading your dashboard...</p>;
  }

  if (error) {
    return (
      <View className="card">
        <Heading level={4}>Session Error</Heading>
        <p className="status-text">{error}</p>
        <Button onClick={signOut}>Sign Out</Button>
      </View>
    );
  }

  return (
    <Routes>
      <Route path="/patient" element={<PatientDashboard userSub={userSub} signOut={signOut} />} />
      <Route path="/coach" element={<CoachDashboard coachSub={userSub} accessToken={accessToken} signOut={signOut} />} />
      <Route path="*" element={<Navigate to={role === 'coach' ? '/coach' : '/patient'} replace />} />
    </Routes>
  );
}

function AuthForm({ onSignedIn }) {
  const [mode, setMode] = useState('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState('patient');
  const [confirmationCode, setConfirmationCode] = useState('');
  const [pendingConfirmation, setPendingConfirmation] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [successMessage, setSuccessMessage] = useState('');

  const resetMessages = () => {
    setErrorMessage('');
    setSuccessMessage('');
  };

  async function handleSignIn(event) {
    event.preventDefault();
    resetMessages();
    setIsSubmitting(true);

    try {
      const result = await signIn({ username: email, password });
      if (result?.nextStep?.signInStep === 'CONFIRM_SIGN_UP') {
        setPendingConfirmation(true);
        setSuccessMessage('Please confirm your email before signing in.');
      } else if (result?.isSignedIn) {
        onSignedIn();
      }
    } catch (error) {
      setErrorMessage(error.message || 'Unable to sign in.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignUp(event) {
    event.preventDefault();
    resetMessages();
    setIsSubmitting(true);

    try {
      const result = await signUp({
        username: email,
        password,
        options: {
          userAttributes: {
            email,
            'custom:role': role
          }
        }
      });

      if (result?.user?.userId) {
        setPendingConfirmation(true);
        setSuccessMessage('Check your email for a confirmation code.');
      }
    } catch (error) {
      setErrorMessage(error.message || 'Unable to sign up.');
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleConfirm(event) {
    event.preventDefault();
    resetMessages();
    setIsSubmitting(true);

    try {
      await confirmSignUp({ username: email, confirmationCode });
      setPendingConfirmation(false);
      setMode('signIn');
      setSuccessMessage('Email confirmed. You can sign in now.');
    } catch (error) {
      setErrorMessage(error.message || 'Unable to confirm account.');
    } finally {
      setIsSubmitting(false);
    }
  }

  const formTitle = mode === 'signIn' ? 'Sign in' : 'Create account';

  return (
    <div className="auth-card">
      <div className="auth-toggle">
        <button type="button" className={mode === 'signIn' ? 'active' : ''} onClick={() => { resetMessages(); setMode('signIn'); setPendingConfirmation(false); }}>
          Sign In
        </button>
        <button type="button" className={mode === 'signUp' ? 'active' : ''} onClick={() => { resetMessages(); setMode('signUp'); setPendingConfirmation(false); }}>
          Sign Up
        </button>
      </div>

      {pendingConfirmation ? (
        <form onSubmit={handleConfirm} className="auth-form">
          <Heading level={3}>Confirm your email</Heading>
          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label>
            Confirmation code
            <input type="text" value={confirmationCode} onChange={(event) => setConfirmationCode(event.target.value)} required />
          </label>
          {errorMessage && <p className="auth-error">{errorMessage}</p>}
          {successMessage && <p className="auth-success">{successMessage}</p>}
          <Button type="submit" isLoading={isSubmitting}>Confirm account</Button>
        </form>
      ) : (
        <form onSubmit={mode === 'signIn' ? handleSignIn : handleSignUp} className="auth-form">
          <Heading level={3}>{formTitle}</Heading>

          <label>
            Email
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>

          <label>
            Password
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} required minLength={8} />
          </label>

          {mode === 'signUp' && (
            <label>
              I am a
              <select value={role} onChange={(event) => setRole(event.target.value)}>
                <option value="patient">Athlete / Patient</option>
                <option value="coach">Coach</option>
              </select>
            </label>
          )}

          {errorMessage && <p className="auth-error">{errorMessage}</p>}
          {successMessage && <p className="auth-success">{successMessage}</p>}

          <Button type="submit" isLoading={isSubmitting}>
            {mode === 'signIn' ? 'Sign in' : 'Create account'}
          </Button>
        </form>
      )}
    </div>
  );
}

function AuthGate() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isCheckingSession, setIsCheckingSession] = useState(true);

  useEffect(() => {
    async function checkSession() {
      try {
        await fetchAuthSession();
        setIsAuthenticated(true);
      } catch {
        setIsAuthenticated(false);
      } finally {
        setIsCheckingSession(false);
      }
    }

    checkSession();
  }, []);

  async function handleSignOut() {
    await signOut();
    setIsAuthenticated(false);
  }

  if (isCheckingSession) {
    return <p className="muted">Checking session...</p>;
  }

  if (!isAuthenticated) {
    return <AuthForm onSignedIn={() => setIsAuthenticated(true)} />;
  }

  return (
    <BrowserRouter>
      <RoleDashboard signOut={handleSignOut} />
    </BrowserRouter>
  );
}

export default function App() {
  return (
    <div className="page-bg">
      <AuthGate />
    </div>
  );
}
