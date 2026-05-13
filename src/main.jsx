import React, { useState, useEffect } from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './index.css';
import { storageAPI, loadAllFromSupabase, startRealtimeListeners } from './lib/syncStorage.js';

// Reemplazar window.storage con nuestro wrapper que sincroniza con Supabase
window.storage = storageAPI;

// Pantalla de carga mientras traemos los datos desde Supabase
function Loader({ step, total, current }) {
  const pct = total > 0 ? Math.round((step / total) * 100) : 0;
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'linear-gradient(135deg, #fef3c7 0%, #fde68a 50%, #fbbf24 100%)',
      padding: 20,
      fontFamily: 'system-ui, sans-serif',
    }}>
      <div style={{
        background: 'white',
        borderRadius: 24,
        padding: 32,
        textAlign: 'center',
        maxWidth: 400,
        width: '100%',
        boxShadow: '0 10px 40px rgba(0,0,0,0.1)',
      }}>
        <div style={{ fontSize: 48, marginBottom: 12 }}>🚛</div>
        <h1 style={{ margin: 0, color: '#047857', fontSize: 22, fontWeight: 800 }}>Transporte Emporium</h1>
        <p style={{ color: '#78716c', fontSize: 13, marginTop: 4, marginBottom: 24 }}>Sincronizando datos...</p>
        <div style={{
          height: 8,
          background: '#f5f5f4',
          borderRadius: 8,
          overflow: 'hidden',
          marginBottom: 12,
        }}>
          <div style={{
            height: '100%',
            width: `${pct}%`,
            background: 'linear-gradient(90deg, #10b981, #059669)',
            transition: 'width 0.3s',
          }} />
        </div>
        <p style={{ color: '#78716c', fontSize: 11, fontFamily: 'monospace', margin: 0 }}>
          {current ? `${current} (${step}/${total})` : 'Conectando...'}
        </p>
      </div>
    </div>
  );
}

function Root() {
  const [ready, setReady] = useState(false);
  const [loadStep, setLoadStep] = useState(0);
  const [loadTotal, setLoadTotal] = useState(0);
  const [loadCurrent, setLoadCurrent] = useState('');
  const [error, setError] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let stopRealtime = null;

    (async () => {
      try {
        // 1) Cargar todos los datos desde Supabase
        await loadAllFromSupabase((step, total, current) => {
          setLoadStep(step);
          setLoadTotal(total);
          setLoadCurrent(current);
        });

        // 2) Empezar a escuchar cambios en tiempo real
        stopRealtime = startRealtimeListeners((key, value) => {
          // Cuando llega un cambio remoto, forzamos un refresh de la app
          // (incrementa una key que React usa para remontar el componente)
          setRefreshKey((k) => k + 1);
        });

        setReady(true);
      } catch (e) {
        console.error('Error inicial:', e);
        setError(e.message || 'Error de conexión');
        // Aunque haya error, dejamos arrancar la app con cache local
        setTimeout(() => setReady(true), 1000);
      }
    })();

    return () => {
      if (stopRealtime) stopRealtime();
    };
  }, []);

  if (!ready) {
    if (error) {
      return (
        <div style={{
          minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center',
          padding: 20, fontFamily: 'system-ui, sans-serif',
        }}>
          <div style={{ textAlign: 'center', maxWidth: 400 }}>
            <div style={{ fontSize: 48 }}>⚠️</div>
            <p style={{ color: '#b91c1c' }}>Sin conexión a la nube</p>
            <p style={{ color: '#78716c', fontSize: 13 }}>{error}</p>
            <p style={{ color: '#78716c', fontSize: 12 }}>Cargando modo offline...</p>
          </div>
        </div>
      );
    }
    return <Loader step={loadStep} total={loadTotal} current={loadCurrent} />;
  }

  // refreshKey en la key fuerza un re-mount cuando llega un cambio realtime
  return <App key={refreshKey} />;
}

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
);
