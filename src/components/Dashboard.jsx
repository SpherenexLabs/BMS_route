import React, { useState, useEffect, useRef } from 'react';
import axios from 'axios';
import { ref, onValue, off } from 'firebase/database';
import { db } from '../services/firebase';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer, BarChart, Bar
} from 'recharts';
import './Dashboard.css';

const API_BASE_URL = 'http://localhost:5001';

const Dashboard = () => {
  const [isFeedError, setIsFeedError] = useState(false);
  const [systemStatus, setSystemStatus] = useState({
    model_loaded: false,
    firebase_connected: false,
    last_detection: 0,
    detection_cooldown: 0,
    auto_clear_delay: 0,
    auto_clear_timer: { active: false, remaining_seconds: 0 }
  });
  
  // Real-time BMS data state
  const [bms, setBms] = useState({
    soc: 0,
    v: 0,
    i: 0,
    p: 0,
    temp: 0,
    hum: 0,
    fan: 'OFF',
    pump: 'OFF',
    direction: 'F',
    detected: 0,
    timestamp: ''
  });
  
  const [historicalData, setHistoricalData] = useState([]);
  const [detectionHistory, setDetectionHistory] = useState([]);
  const [lastError, setLastError] = useState('');
  const [connectionStatus, setConnectionStatus] = useState('connecting');
  const [manualClearStatus, setManualClearStatus] = useState('');
  const [debugInfo, setDebugInfo] = useState('');
  const [firebaseConnected, setFirebaseConnected] = useState(false);
  const [temperatureAlert, setTemperatureAlert] = useState(null);
  const [batteryAlert, setBatteryAlert] = useState(null);
  // Relay/pump control removed; we only display pump from BMS

  const videoFeedUrl = `${API_BASE_URL}/video_feed`;
  const videoRef = useRef(null);

  useEffect(() => {
    setDebugInfo(`Connecting to: ${API_BASE_URL} from: ${window.location.origin}`);

    // Set up real-time Firebase listener for BMS data
    const bmsRef = ref(db, 'BMS');

    const unsubscribeBms = onValue(bmsRef, (snapshot) => {
      const data = snapshot.val();
      if (data) {
        const parsed = {
          soc: parseFloat(data.soc) || 0,
          v: parseFloat(data.v) || 0,
          i: parseFloat(data.i) || 0,
          p: parseFloat(data.p) || 0,
          temp: parseFloat(data.temp) || 0,
          hum: parseFloat(data.hum) || 0,
          fan: String(data.fan ?? 'OFF'),
          pump: String(data.pump ?? 'OFF'),
          direction: String(data.direction ?? 'F'),
          detected: Number(data.detected ?? 0),
          timestamp: new Date().toLocaleTimeString()
        };

        setBms(parsed);
        setFirebaseConnected(true);
        setConnectionStatus('connected');

        // Temperature alert logic
        const temp = parsed.temp;
        if (temp > 33) {
          setTemperatureAlert({
            type: 'overheat',
            message: '🚨 OVERHEAT ALERT! Temperature exceeds 33°C',
            temperature: temp,
            severity: 'critical'
          });
        } else if (temp >= 27) {
          setTemperatureAlert({
            type: 'cooling',
            message: '❄️ Cooling Fan is ON - Temperature ≥27°C',
            temperature: temp,
            severity: 'warning'
          });
        } else {
          setTemperatureAlert(null);
        }

        // Battery alert logic
        const soc = parsed.soc;
        if (soc > 99) {
          setBatteryAlert({
            type: 'overcharge',
            message: '⚠️ Over-voltage & Over-current risk — Battery >99%',
            soc,
            severity: 'warning'
          });
        } else if (soc < 20) {
          setBatteryAlert({
            type: 'critical_low',
            message: '🚨 CRITICAL BATTERY LOW (<20%)',
            soc,
            severity: 'critical'
          });
        } else {
          setBatteryAlert(null);
        }

        // Add to historical data (keep last 20 points)
        setHistoricalData(prev => {
          const updated = [...prev, parsed];
          return updated.slice(-20);
        });
      } else {
        setFirebaseConnected(false);
      }
    }, (error) => {
      console.error('Firebase listener error:', error);
      setFirebaseConnected(false);
      setConnectionStatus('disconnected');
      setLastError(`Firebase Error: ${error.message}`);
    });

  // Set up real-time listener for detection status
    const detectionRef = ref(db, 'BMS/detected');
    
    const unsubscribeDetection = onValue(detectionRef, (snapshot) => {
      const detectionValue = snapshot.val();
      if (detectionValue !== null) {
        const detectionTime = new Date();
        const newEntry = {
          type: detectionValue === "1" ? 'Dust Detected' : 'System Clear',
          timestamp: detectionTime.toLocaleString(),
          status: detectionValue === "1" ? 'active' : 'cleared'
        };

        setDetectionHistory(prev => {
          // Avoid duplicates by checking recent entries
          const exists = prev.find(item =>
            Math.abs(new Date(item.timestamp).getTime() - detectionTime.getTime()) < 2000
          );
          if (!exists) {
            return [newEntry, ...prev.slice(0, 9)]; // Keep last 10 entries
          }
          return prev;
        });
      }
    });

    // Relay status is part of BMS object; no separate listener

    // Fallback API status check (less frequent)
    const fetchStatus = () => {
      axios.get(`${API_BASE_URL}/status`, {
        timeout: 5000,
        headers: { 'Content-Type': 'application/json' }
      })
      .then(response => {
        setSystemStatus(response.data);
        if (!firebaseConnected) {
          setConnectionStatus('connected');
        }
        setIsFeedError(false);
      })
      .catch(error => {
        console.error("Status API error:", error);
        if (!firebaseConnected) {
          setConnectionStatus('disconnected');
          let errorMessage = 'Connection failed';
          if (error.code === 'ERR_NETWORK') {
            errorMessage = 'Network error - Is Flask server running on port 5001?';
          }
          setLastError(errorMessage);
        }
        setIsFeedError(true);
      });
    };

    // Initial status fetch and periodic backup
    fetchStatus();
    const statusInterval = setInterval(fetchStatus, 10000); // Check every 10 seconds as backup

    // Cleanup function
    return () => {
      // Remove Firebase listeners
      off(bmsRef);
      off(detectionRef);
      unsubscribeBms();
      unsubscribeDetection();
      clearInterval(statusInterval);
    };
  }, [firebaseConnected]);

  // Pump toggle removed; showing status only from BMS

  const handleManualClear = () => {
    setManualClearStatus('Clearing detection...');
    // Optionally, you can write to Firebase to clear detection
    // set(ref(database, 'BMS/detected'), "0");
    
    setTimeout(() => {
      setManualClearStatus('System will auto-clear when no dust is detected');
    }, 1000);
    setTimeout(() => setManualClearStatus(''), 3000);
  };

  const formatTimestamp = (timestamp) => {
    if (!timestamp) return 'Never';
    return new Date(timestamp * 1000).toLocaleString();
  };

  const getConnectionStatusIcon = () => {
    if (firebaseConnected) return '🟢';
    switch (connectionStatus) {
      case 'connected': return '🟡';
      case 'disconnected': return '🔴';
      default: return '🟡';
    }
  };

  const getBatteryColor = (soc) => {
    if (soc > 75) return '#4CAF50';
    if (soc > 50) return '#FF9800';
    if (soc > 25) return '#FF5722';
    return '#F44336';
  };

  return (
    <div className="dashboard-container">
      <div className="dashboard-header">
        <h1>🌞 Solar Panel Real-Time Monitoring System</h1>
        <div style={{ 
          fontSize: '0.9rem', 
          color: firebaseConnected ? '#4CAF50' : '#ff6b6b',
          textAlign: 'center',
          marginTop: '5px'
        }}>
          {/* {firebaseConnected ? '🔴 LIVE - Real-time updates active' : '⚠️ Using backup polling mode'} */}
        </div>
      </div>

      {/* Temperature Alert Notification */}
      {temperatureAlert && (
        <div style={{
          position: 'fixed',
          top: '20px',
          right: '20px',
          zIndex: 1000,
          background: temperatureAlert.severity === 'critical' 
            ? 'linear-gradient(135deg, #ff4444, #cc0000)' 
            : 'linear-gradient(135deg, #ff9800, #f57c00)',
          color: 'white',
          padding: '15px 20px',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          border: temperatureAlert.severity === 'critical' 
            ? '2px solid #ff0000' 
            : '2px solid #ff9800',
          maxWidth: '320px',
          animation: temperatureAlert.severity === 'critical' 
            ? 'pulse 1s infinite' 
            : 'none'
        }}>
          <div style={{ 
            fontWeight: 'bold', 
            fontSize: '1.1rem', 
            marginBottom: '8px',
            display: 'flex',
            alignItems: 'center',
            gap: '8px'
          }}>
            {temperatureAlert.message}
          </div>
          <div style={{ fontSize: '0.9rem', opacity: '0.9' }}>
            Current Temperature: {temperatureAlert.temperature}°C
          </div>
          {temperatureAlert.severity === 'critical' && (
            <div style={{ 
              fontSize: '0.85rem', 
              marginTop: '5px',
              fontStyle: 'italic',
              opacity: '0.9'
            }}>
              ⚠️ Check system immediately!
            </div>
          )}
        </div>
      )}

      {/* Battery Alert Notification */}
      {batteryAlert && (
        <div style={{
          position: 'fixed',
          top: '100px',
          right: '20px',
          zIndex: 1000,
          background: batteryAlert.severity === 'critical'
            ? 'linear-gradient(135deg, #ff4444, #cc0000)'
            : 'linear-gradient(135deg, #ffb74d, #ff9800)',
          color: 'white',
          padding: '12px 18px',
          borderRadius: '12px',
          boxShadow: '0 8px 32px rgba(0, 0, 0, 0.3)',
          border: batteryAlert.severity === 'critical' ? '2px solid #ff0000' : '2px solid #ff9800',
          maxWidth: '360px',
          animation: batteryAlert.severity === 'critical' ? 'pulse 1s infinite' : 'none'
        }}>
          <div style={{ fontWeight: 'bold', fontSize: '1rem', marginBottom: '6px', display: 'flex', alignItems: 'center', gap: '8px' }}>
            {batteryAlert.message}
          </div>
          <div style={{ fontSize: '0.9rem', opacity: '0.95' }}>
            Battery: {batteryAlert.soc}%
          </div>
          {batteryAlert.severity === 'critical' && (
            <div style={{ fontSize: '0.85rem', marginTop: '6px', fontStyle: 'italic' }}>🚨 Immediate action recommended</div>
          )}
        </div>
      )}

      <div className="main-content">
        {/* Video Section */}
        <div className="video-section">
          {/* <div className="video-feed-container">
            {isFeedError ? (
              <div className="error-overlay">
                <p>📷 Camera Feed Unavailable</p>
                <span>Could not connect to the dust detection camera.</span>
                <br />
                <small style={{ color: '#ff6b6b', marginTop: '10px', display: 'block' }}>
                  {getConnectionStatusIcon()} 
                  {firebaseConnected ? 'Firebase: Connected' : `Server: ${connectionStatus}`}
                  {lastError && ` - ${lastError}`}
                </small>
              </div>
            ) : (
              <img
                ref={videoRef}
                src={`${videoFeedUrl}?t=${Date.now()}`}
                alt="Solar Panel Dust Detection Feed"
                onError={() => setIsFeedError(true)}
                onLoad={() => setIsFeedError(false)}
              />
            )}
          </div> */}

          {/* Real-time BMS Metrics Cards */}
          <div className="metrics-cards" style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: '15px',
            marginTop: '20px'
          }}>
            <div className="metric-card card" style={{
              background: `linear-gradient(135deg, ${getBatteryColor(bms.soc)}, ${getBatteryColor(bms.soc)}aa)`,
              color: 'white',
              textAlign: 'center',
              padding: '20px',
              position: 'relative'
            }}>
              <h3>🔋 Battery</h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{bms.soc}%</div>
              {firebaseConnected && (
                <div style={{ 
                  position: 'absolute', 
                  top: '5px', 
                  right: '5px', 
                  fontSize: '12px',
                  background: 'rgba(255,255,255,0.3)',
                  padding: '2px 6px',
                  borderRadius: '10px'
                }}>
                  🔴 LIVE
                </div>
              )}
            </div>

            <div className="metric-card card" style={{
              background: 'linear-gradient(135deg, #2196F3, #2196F3aa)',
              color: 'white',
              textAlign: 'center',
              padding: '20px',
              position: 'relative'
            }}>
              <h3>⚡ Current</h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{Math.abs(bms.i)}A</div>
              {firebaseConnected && (
                <div style={{ 
                  position: 'absolute', 
                  top: '5px', 
                  right: '5px', 
                  fontSize: '12px',
                  background: 'rgba(255,255,255,0.3)',
                  padding: '2px 6px',
                  borderRadius: '10px'
                }}>
                  🔴 LIVE
                </div>
              )}
            </div>

            <div className="metric-card card" style={{
              background: 'linear-gradient(135deg, #9C27B0, #9C27B0aa)',
              color: 'white',
              textAlign: 'center',
              padding: '20px',
              position: 'relative'
            }}>
              <h3>💡 Power</h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{Math.abs(bms.p)}W</div>
              {firebaseConnected && (
                <div style={{ 
                  position: 'absolute', 
                  top: '5px', 
                  right: '5px', 
                  fontSize: '12px',
                  background: 'rgba(255,255,255,0.3)',
                  padding: '2px 6px',
                  borderRadius: '10px'
                }}>
                  🔴 LIVE
                </div>
              )}
            </div>

            <div className="metric-card card" style={{
              background: 'linear-gradient(135deg, #FF5722, #FF5722aa)',
              color: 'white',
              textAlign: 'center',
              padding: '20px',
              position: 'relative'
            }}>
              <h3>⚡ Voltage</h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{bms.v}V</div>
              {firebaseConnected && (
                <div style={{ 
                  position: 'absolute', 
                  top: '5px', 
                  right: '5px', 
                  fontSize: '12px',
                  background: 'rgba(255,255,255,0.3)',
                  padding: '2px 6px',
                  borderRadius: '10px'
                }}>
                  🔴 LIVE
                </div>
              )}
            </div>
            <div className="metric-card card" style={{
              background: temperatureAlert?.severity === 'critical' 
                ? 'linear-gradient(135deg, #ff4444, #cc0000)' 
                : temperatureAlert?.severity === 'warning'
                ? 'linear-gradient(135deg, #ff9800, #f57c00)'
                : 'linear-gradient(135deg, #4CAF50, #45a049)',
              color: 'white',
              textAlign: 'center',
              padding: '20px',
              position: 'relative',
              border: temperatureAlert?.severity === 'critical' ? '2px solid #ff0000' : 'none',
              animation: temperatureAlert?.severity === 'critical' ? 'pulse 2s infinite' : 'none'
            }}>
              <h3>
                🌡️ Temperature 
                {temperatureAlert?.severity === 'critical' && ' 🚨'}
                {temperatureAlert?.severity === 'warning' && ' ❄️'}
              </h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{bms.temp}°C</div>
              {temperatureAlert && (
                <div style={{ 
                  position: 'absolute', 
                  bottom: '5px', 
                  left: '50%',
                  transform: 'translateX(-50%)',
                  fontSize: '10px',
                  background: 'rgba(0,0,0,0.4)',
                  padding: '2px 6px',
                  borderRadius: '8px',
                  fontWeight: 'bold'
                }}>
                  {temperatureAlert.severity === 'critical' ? 'OVERHEAT!' : 'FAN ON'}
                </div>
              )}
              {firebaseConnected && (
                <div style={{ position: 'absolute', top: '5px', right: '5px', fontSize: '12px', background: 'rgba(255,255,255,0.3)', padding: '2px 6px', borderRadius: '10px' }}>🔴 LIVE</div>
              )}
            </div>
            <div className="metric-card card" style={{
              background: 'linear-gradient(135deg, #00BCD4, #00BCD4aa)',
              color: 'white',
              textAlign: 'center',
              padding: '20px',
              position: 'relative'
            }}>
              <h3>💧 Humidity</h3>
              <div style={{ fontSize: '2rem', fontWeight: 'bold' }}>{bms.hum}%</div>
              {firebaseConnected && (
                <div style={{ position: 'absolute', top: '5px', right: '5px', fontSize: '12px', background: 'rgba(255,255,255,0.3)', padding: '2px 6px', borderRadius: '10px' }}>🔴 LIVE</div>
              )}
            </div>
          </div>
        </div>

        <div className="side-panel">
          {/* BMS Status */}
          <div className="history-panel card" style={{display:'flex', flexDirection:'column', gap: '10px'}}>
            <h3><i className="fas fa-info-circle"></i> BMS Status</h3>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <span style={{color: 'var(--text-secondary)'}}>Fan:</span>
              <span style={{fontWeight: 700, color: bms.fan === 'ON' ? 'var(--authorised-color)' : 'var(--text-primary)'}}>{bms.fan}</span>
            </div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <span style={{color: 'var(--text-secondary)'}}>Pump:</span>
              <span style={{fontWeight: 700, color: bms.pump === 'ON' ? 'var(--authorised-color)' : 'var(--text-primary)'}}>{bms.pump}</span>
            </div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <span style={{color: 'var(--text-secondary)'}}>Direction:</span>
              <span style={{fontWeight: 700, color: 'var(--text-primary)'}}>{bms.direction}</span>
            </div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <span style={{color: 'var(--text-secondary)'}}>Detected:</span>
              <span style={{fontWeight: 700, color: bms.detected ? '#f39c12' : 'var(--authorised-color)'}}>
                {bms.detected ? 'Dust Detected' : 'Clear'}
              </span>
            </div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <span style={{color: 'var(--text-secondary)'}}>Temperature Status:</span>
              <span style={{
                fontWeight: 700, 
                color: temperatureAlert?.severity === 'critical' 
                  ? '#ff4444' 
                  : temperatureAlert?.severity === 'warning' 
                  ? '#ff9800' 
                  : 'var(--authorised-color)'
              }}>
                {temperatureAlert?.severity === 'critical' 
                  ? '🚨 OVERHEAT' 
                  : temperatureAlert?.severity === 'warning' 
                  ? '❄️ COOLING' 
                  : '✅ NORMAL'}
              </span>
            </div>
            <div style={{display:'flex', alignItems:'center', justifyContent:'space-between'}}>
              <span style={{color: 'var(--text-secondary)'}}>Battery:</span>
              <span style={{
                fontWeight: 700,
                color: batteryAlert?.severity === 'critical'
                  ? '#ff4444'
                  : batteryAlert?.severity === 'warning'
                  ? '#ff9800'
                  : getBatteryColor(bms.soc)
              }}>
                {bms.soc}% {batteryAlert ? ` - ${batteryAlert.message}` : ''}
              </span>
            </div>
          </div>
          {/* System Status Panel */}
          {/* <div className="registration-panel card">
            <h2><i className="fas fa-cogs"></i> System Status</h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <i className="fas fa-database"></i> Firebase Real-time:
                </span>
                <span style={{
                  color: firebaseConnected ? 'var(--authorised-color)' : 'var(--unauthorised-color)',
                  fontWeight: '600'
                }}>
                  {firebaseConnected ? 'LIVE 🔴' : 'Offline ❌'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <i className="fas fa-robot"></i> AI Model:
                </span>
                <span style={{
                  color: systemStatus.model_loaded ? 'var(--authorised-color)' : 'var(--unauthorised-color)',
                  fontWeight: '600'
                }}>
                  {systemStatus.model_loaded ? 'Loaded ✅' : 'Failed ❌'}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  {getConnectionStatusIcon()} Connection:
                </span>
                <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                  {firebaseConnected ? 'Real-time' : connectionStatus}
                </span>
              </div>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span style={{ color: 'var(--text-secondary)' }}>
                  <i className="fas fa-clock"></i> Update Mode:
                </span>
                <span style={{ color: 'var(--text-primary)', fontWeight: '600' }}>
                  {firebaseConnected ? 'Instant' : 'Polling'}
                </span>
              </div>
            </div>

            <button className="registration-button" onClick={handleManualClear} style={{ marginTop: '15px' }}>
              <i className="fas fa-broom"></i> Clear Detection
            </button>
            {manualClearStatus && <p className="registration-status">{manualClearStatus}</p>}
          </div> */}

          {/* Real-time Charts remain the same */}
          <div className="history-panel card">
            <h3>
              <i className="fas fa-chart-line"></i> Battery Trends 
              {firebaseConnected && <span style={{color: '#ff4444', fontSize: '0.8rem'}}> 🔴 LIVE</span>}
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line 
                  type="monotone" 
                  dataKey="soc" 
                  stroke="#4CAF50" 
                  name="Battery %" 
                  dot={firebaseConnected ? {fill: '#ff4444', r: 3} : {fill: '#4CAF50', r: 2}}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {/* Other chart panels remain similar with live indicators */}
          <div className="history-panel card">
            <h3>
              <i className="fas fa-bolt"></i> Power & Voltage
              {firebaseConnected && <span style={{color: '#ff4444', fontSize: '0.8rem'}}> 🔴 LIVE</span>}
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={historicalData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="p" stroke="#9C27B0" name="Power (W)" />
                <Line type="monotone" dataKey="v" stroke="#FF5722" name="Voltage (V)" />
              </LineChart>
            </ResponsiveContainer>
          </div>

          <div className="history-panel card">
            <h3>
              <i className="fas fa-tachometer-alt"></i> Current Flow
              {firebaseConnected && <span style={{color: '#ff4444', fontSize: '0.8rem'}}> 🔴 LIVE</span>}
            </h3>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={historicalData.slice(-10)}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="timestamp" />
                <YAxis />
                <Tooltip />
                <Bar dataKey="i" fill="#2196F3" name="Current (A)" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          {/* Recent Activity with real-time detection updates */}
          <div className="history-panel card">
            <h3>
              <i className="fas fa-history"></i> Recent Activity
              {firebaseConnected && <span style={{color: '#ff4444', fontSize: '0.8rem'}}> 🔴 LIVE</span>}
            </h3>
            <ul className="history-list">
              {detectionHistory.length > 0 ? detectionHistory.slice(0, 5).map((item, index) => (
                <li key={index} className={`history-item ${item.status === 'active' ? 'unauthorised' : 'authorised'}`}>
                  <span>{item.status === 'active' ? '🔴' : '🟢'} {item.type}</span>
                  <span className="history-time">
                    {new Date(item.timestamp).toLocaleTimeString()}
                  </span>
                </li>
              )) : (
                <li style={{
                  textAlign: 'center',
                  padding: '20px',
                  color: 'var(--text-muted)',
                  fontStyle: 'italic'
                }}>
                  No recent detections
                  {firebaseConnected && <div style={{fontSize: '0.8rem', color: '#4CAF50'}}>🔴 Listening for real-time updates...</div>}
                </li>
              )}
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Dashboard;
