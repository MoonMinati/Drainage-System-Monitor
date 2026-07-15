import {
  Activity,
  AlertTriangle,
  Bluetooth,
  CheckCircle2,
  CircuitBoard,
  CloudRain,
  Copy,
  Droplets,
  Info,
  Power,
  Radio,
  Settings,
  ShieldAlert,
  Terminal,
  Waves,
} from 'lucide-react';
import {useEffect, useMemo, useRef, useState} from 'react';

type ControlMode = 'manual' | 'auto';
type LogKind = 'info' | 'success' | 'warning' | 'error' | 'rx' | 'tx';
type BleProfileKey = 'hm10' | 'nus' | 'custom';
type MeasurementMode = 'level' | 'distance';
type TelemetryState = 'simulator' | 'waiting' | 'live' | 'stale';

type LogEntry = {
  id: number;
  kind: LogKind;
  message: string;
  time: string;
};

type BleProfile = {
  label: string;
  serviceUuid: string;
  txUuid: string;
  rxUuid: string;
  protocol: string;
};

const BLE_PROFILES: Record<Exclude<BleProfileKey, 'custom'>, BleProfile> = {
  hm10: {
    label: 'HM-10 / CC2541 Serial',
    serviceUuid: '0000ffe0-0000-1000-8000-00805f9b34fb',
    txUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
    rxUuid: '0000ffe1-0000-1000-8000-00805f9b34fb',
    protocol: 'HM-10 FFE0 serial',
  },
  nus: {
    label: 'Nordic UART Service',
    serviceUuid: '6e400001-b5a3-f393-e0a9-e50e24dcca9e',
    txUuid: '6e400003-b5a3-f393-e0a9-e50e24dcca9e',
    rxUuid: '6e400002-b5a3-f393-e0a9-e50e24dcca9e',
    protocol: 'Nordic UART Service',
  },
};

const sketch = `#include <SoftwareSerial.h>

const int trigPin = 8;
const int echoPin = 9;
const int relayPin = 7;
const bool relayActiveHigh = true;
const float channelDepthCm = 60.0;

SoftwareSerial ble(2, 3); // RX, TX
bool pumpOn = false;
bool autoMode = false;
float thresholdCm = 30.0;
unsigned long lastTelemetryMs = 0;

void setRelay(bool enabled) {
  pumpOn = enabled;
  digitalWrite(relayPin, relayActiveHigh ? (enabled ? HIGH : LOW) : (enabled ? LOW : HIGH));
}

void setup() {
  pinMode(trigPin, OUTPUT);
  pinMode(echoPin, INPUT);
  pinMode(relayPin, OUTPUT);
  setRelay(false);
  Serial.begin(9600);
  ble.begin(9600);
}

float readDistanceCm() {
  digitalWrite(trigPin, LOW);
  delayMicroseconds(2);
  digitalWrite(trigPin, HIGH);
  delayMicroseconds(10);
  digitalWrite(trigPin, LOW);
  long duration = pulseIn(echoPin, HIGH, 30000);
  if (duration == 0) return -1.0;
  return duration * 0.0343 / 2.0;
}

void handleCommand(String cmd) {
  cmd.trim();
  cmd.toUpperCase();

  if (cmd == "ON" || cmd == "1") {
    autoMode = false;
    setRelay(true);
  } else if (cmd == "OFF" || cmd == "0") {
    autoMode = false;
    setRelay(false);
  } else if (cmd == "AUTO" || cmd == "MODE:AUTO") {
    autoMode = true;
  } else if (cmd == "MANUAL" || cmd == "MODE:MANUAL") {
    autoMode = false;
  } else if (cmd.startsWith("THR:")) {
    thresholdCm = cmd.substring(4).toFloat();
    thresholdCm = constrain(thresholdCm, 5.0, channelDepthCm - 2.0);
  }
}

void loop() {
  if (ble.available()) {
    String cmd = ble.readStringUntil('\\n');
    handleCommand(cmd);
  }

  float sensorDistance = readDistanceCm();
  if (sensorDistance < 0) {
    ble.println("ERR:SENSOR");
    delay(500);
    return;
  }

  float waterLevel = constrain(channelDepthCm - sensorDistance, 0.0, channelDepthCm);

  if (autoMode && waterLevel >= thresholdCm) {
    setRelay(true);
  } else if (autoMode && waterLevel <= thresholdCm - 5.0) {
    setRelay(false);
  }

  ble.print(waterLevel, 1);
  ble.print(",");
  ble.println(pumpOn ? "ON" : "OFF");
  Serial.print(waterLevel, 1);
  Serial.print(",");
  Serial.println(pumpOn ? "ON" : "OFF");
  delay(500);
}`;

const wiringGuide = `HC-SR04 ultrasonic sensor:
VCC -> Arduino 5V
GND -> Arduino GND
TRIG -> Arduino D8
ECHO -> Arduino D9

HM-10 BLE module:
VCC -> Arduino 5V or 3.3V module input
GND -> Arduino GND
TXD -> Arduino D2
RXD -> Arduino D3 through a voltage divider

Relay / pump gate:
IN  -> Arduino D7
VCC -> Arduino 5V
GND -> Arduino GND

Telemetry frame:
distance,status
Example:
24.8,OFF

For most ultrasonic installs, the raw sensor value is distance from sensor to water.
Set the app input mode to "Sensor distance" and enter the channel depth.
If you upload the included sketch unchanged, it already sends converted water level.`;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function nowLabel() {
  return new Date().toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function App() {
  const [level, setLevel] = useState(15);
  const [threshold, setThreshold] = useState(30);
  const [pumpOn, setPumpOn] = useState(false);
  const [mode, setMode] = useState<ControlMode>('manual');
  const [isConnected, setIsConnected] = useState(false);
  const [deviceName, setDeviceName] = useState('');
  const [profile, setProfile] = useState<BleProfileKey>('hm10');
  const [customServiceUuid, setCustomServiceUuid] = useState('');
  const [customTxUuid, setCustomTxUuid] = useState('');
  const [customRxUuid, setCustomRxUuid] = useState('');
  const [scanAllDevices, setScanAllDevices] = useState(true);
  const [measurementMode, setMeasurementMode] = useState<MeasurementMode>('level');
  const [channelDepth, setChannelDepth] = useState(60);
  const [lastRawMeasurement, setLastRawMeasurement] = useState(15);
  const [lastTelemetryAt, setLastTelemetryAt] = useState<number | null>(null);
  const [rainActive, setRainActive] = useState(false);
  const [releaseActive, setReleaseActive] = useState(false);
  const [history, setHistory] = useState<number[]>(() => Array.from({length: 36}, () => 15));
  const [logs, setLogs] = useState<LogEntry[]>(() => [
    {id: 1, kind: 'info', message: 'Simulator ready. Connect a BLE module when hardware is available.', time: nowLabel()},
  ]);
  const [guideTab, setGuideTab] = useState<'sketch' | 'wiring'>('sketch');
  const [copied, setCopied] = useState(false);
  const [clockTick, setClockTick] = useState(0);

  const chartRef = useRef<HTMLCanvasElement | null>(null);
  const deviceRef = useRef<any>(null);
  const serverRef = useRef<any>(null);
  const txRef = useRef<any>(null);
  const rxRef = useRef<any>(null);
  const rxBufferRef = useRef('');
  const logIdRef = useRef(2);
  const pumpRef = useRef(pumpOn);
  const connectedRef = useRef(isConnected);
  const lastTelemetryRef = useRef<number | null>(lastTelemetryAt);
  const channelDepthRef = useRef(channelDepth);
  const measurementModeRef = useRef(measurementMode);

  const activeProfile = useMemo(() => {
    if (profile !== 'custom') return BLE_PROFILES[profile];
    return {
      label: 'Custom BLE Serial',
      serviceUuid: customServiceUuid.trim().toLowerCase(),
      txUuid: customTxUuid.trim().toLowerCase(),
      rxUuid: customRxUuid.trim().toLowerCase() || customTxUuid.trim().toLowerCase(),
      protocol: 'Custom GATT UUIDs',
    };
  }, [customRxUuid, customServiceUuid, customTxUuid, profile]);

  const addLog = (message: string, kind: LogKind = 'info') => {
    setLogs((current) => [
      {id: logIdRef.current++, kind, message, time: nowLabel()},
      ...current.slice(0, 79),
    ]);
  };

  const telemetryState: TelemetryState = useMemo(() => {
    void clockTick;
    if (!isConnected) return 'simulator';
    if (!lastTelemetryAt) return 'waiting';
    return Date.now() - lastTelemetryAt > 3500 ? 'stale' : 'live';
  }, [clockTick, isConnected, lastTelemetryAt]);

  const telemetryLabel = {
    simulator: 'Simulator',
    waiting: 'Waiting for Arduino',
    live: 'Live Arduino',
    stale: 'Telemetry Stale',
  }[telemetryState];

  const writeBleCommand = async (command: string) => {
    if (!rxRef.current) return;

    const payload = new TextEncoder().encode(command.endsWith('\n') ? command : `${command}\n`);
    if (typeof rxRef.current.writeValueWithoutResponse === 'function') {
      await rxRef.current.writeValueWithoutResponse(payload);
      return;
    }
    if (typeof rxRef.current.writeValueWithResponse === 'function') {
      await rxRef.current.writeValueWithResponse(payload);
      return;
    }
    await rxRef.current.writeValue(payload);
  };

  const sendCommand = async (nextPumpState: boolean, source: string) => {
    const command = nextPumpState ? 'ON\n' : 'OFF\n';

    if (connectedRef.current && rxRef.current) {
      try {
        await writeBleCommand(command);
        addLog(`${source}: sent ${command.trim()} command`, 'tx');
      } catch (error) {
        addLog(`Command transmission failed: ${(error as Error).message}`, 'error');
      }
    } else {
      addLog(`${source}: ${nextPumpState ? 'pump enabled' : 'pump disabled'} in simulator`, nextPumpState ? 'success' : 'info');
    }
  };

  const setPump = (nextPumpState: boolean, source: string) => {
    setPumpOn((current) => {
      if (current === nextPumpState) return current;
      void sendCommand(nextPumpState, source);
      return nextPumpState;
    });
  };

  const disconnectBluetooth = () => {
    if (serverRef.current?.connected) {
      serverRef.current.disconnect();
    }
  };

  const handleDisconnected = () => {
    setIsConnected(false);
    setDeviceName('');
    deviceRef.current = null;
    serverRef.current = null;
    txRef.current = null;
    rxRef.current = null;
      addLog('Bluetooth disconnected. Simulator controls are active again.', 'warning');
  };

  const handleNotification = (event: Event) => {
    const value = (event.target as any).value as DataView;
    rxBufferRef.current += new TextDecoder('utf-8').decode(value);
    const lines = rxBufferRef.current.split('\n');
    rxBufferRef.current = lines.pop() ?? '';

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      addLog(`RX ${line}`, 'rx');

      if (line.startsWith('ERR:')) {
        addLog(`Arduino reported ${line}. Check sensor wiring and echo timeout.`, 'error');
        continue;
      }

      const [distanceRaw, statusRaw] = line.split(',');
      const parsedMeasurement = Number.parseFloat(distanceRaw);
      if (Number.isFinite(parsedMeasurement)) {
        setLastRawMeasurement(parsedMeasurement);
        const nextLevel =
          measurementModeRef.current === 'level'
            ? clamp(parsedMeasurement, 0, channelDepthRef.current)
            : clamp(channelDepthRef.current - parsedMeasurement, 0, channelDepthRef.current);
        setLevel(nextLevel);
        const receivedAt = Date.now();
        lastTelemetryRef.current = receivedAt;
        setLastTelemetryAt(receivedAt);
      }

      const status = statusRaw?.trim().toUpperCase();
      if (status === 'ON') setPumpOn(true);
      if (status === 'OFF') setPumpOn(false);
    }
  };

  const connectBluetooth = async () => {
    if (!('bluetooth' in navigator)) {
      addLog('Web Bluetooth is not available in this browser. Use Chrome or Edge over HTTPS/localhost.', 'error');
      return;
    }

    if (!activeProfile.serviceUuid || !activeProfile.txUuid || !activeProfile.rxUuid) {
      addLog('Service, TX, and RX UUIDs are required before connecting.', 'error');
      return;
    }

    try {
      addLog(`Scanning for ${activeProfile.label} devices...`, 'info');
      const bluetooth = (navigator as any).bluetooth;
      const requestOptions = scanAllDevices
        ? {
            acceptAllDevices: true,
            optionalServices: [activeProfile.serviceUuid],
          }
        : {
            filters: [{services: [activeProfile.serviceUuid]}],
            optionalServices: [activeProfile.serviceUuid],
          };
      const device = await bluetooth.requestDevice(requestOptions);

      device.addEventListener('gattserverdisconnected', handleDisconnected);
      deviceRef.current = device;
      setDeviceName(device.name || 'BLE device');

      const server = await device.gatt.connect();
      serverRef.current = server;
      const service = await server.getPrimaryService(activeProfile.serviceUuid);
      txRef.current = await service.getCharacteristic(activeProfile.txUuid);
      rxRef.current =
        activeProfile.rxUuid === activeProfile.txUuid
          ? txRef.current
          : await service.getCharacteristic(activeProfile.rxUuid);

      await txRef.current.startNotifications();
      txRef.current.addEventListener('characteristicvaluechanged', handleNotification);
      setIsConnected(true);
      setLastTelemetryAt(null);
      lastTelemetryRef.current = null;
      setRainActive(false);
      setReleaseActive(false);
      addLog(`Connected to ${device.name || 'BLE device'} using ${activeProfile.protocol}.`, 'success');
      await writeBleCommand(`THR:${threshold}`);
      await writeBleCommand(mode === 'auto' ? 'MODE:AUTO' : 'MODE:MANUAL');
    } catch (error) {
      addLog(`Bluetooth connection failed: ${(error as Error).message}`, 'error');
    }
  };

  useEffect(() => {
    pumpRef.current = pumpOn;
    connectedRef.current = isConnected;
    lastTelemetryRef.current = lastTelemetryAt;
    channelDepthRef.current = channelDepth;
    measurementModeRef.current = measurementMode;
  }, [channelDepth, isConnected, lastTelemetryAt, measurementMode, mode, pumpOn, threshold]);

  useEffect(() => {
    if (!isConnected || !rxRef.current) return;
    void writeBleCommand(`THR:${threshold}`).then(() => addLog(`Arduino threshold set to ${threshold} cm`, 'tx'));
  }, [isConnected, threshold]);

  useEffect(() => {
    if (!isConnected || !rxRef.current) return;
    void writeBleCommand(mode === 'auto' ? 'MODE:AUTO' : 'MODE:MANUAL').then(() => addLog(`Arduino mode set to ${mode.toUpperCase()}`, 'tx'));
  }, [isConnected, mode]);

  useEffect(() => {
    if (!isConnected) return;

    const interval = window.setInterval(() => {
      const lastTelemetry = lastTelemetryRef.current;
      if (lastTelemetry && Date.now() - lastTelemetry > 3500) {
        addLog('No Arduino telemetry received for more than 3.5 seconds.', 'warning');
      }
    }, 3500);

    return () => window.clearInterval(interval);
  }, [isConnected]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (connectedRef.current) return;

      setLevel((current) => {
        let next = current;
        if (rainActive) next += 0.5 + Math.random() * 0.55;
        if (pumpRef.current) next -= 0.75 + Math.random() * 0.45;
        if (releaseActive && !pumpRef.current) next -= 0.22;
        next += (Math.random() - 0.5) * 0.08;
        return clamp(next, 2, 58);
      });
    }, 800);

    return () => window.clearInterval(interval);
  }, [rainActive, releaseActive]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setClockTick((current) => current + 1);
    }, 1000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setThreshold((current) => clamp(current, 5, Math.max(6, channelDepth - 2)));
    setLevel((current) => clamp(current, 0, channelDepth));
  }, [channelDepth]);

  useEffect(() => {
    if (mode !== 'auto') return;
    if (level >= threshold && !pumpOn) {
      setPump(true, 'Smart auto threshold');
    }
    if (level <= threshold - 5 && pumpOn) {
      setPump(false, 'Smart auto hysteresis');
    }
  }, [level, mode, pumpOn, threshold]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      setHistory((current) => [...current.slice(1), level]);
    }, 1000);

    return () => window.clearInterval(interval);
  }, [level]);

  useEffect(() => {
    const canvas = chartRef.current;
    if (!canvas) return;

    const context = canvas.getContext('2d');
    if (!context) return;

    const scale = window.devicePixelRatio || 1;
    const width = canvas.clientWidth * scale;
    const height = canvas.clientHeight * scale;
    canvas.width = width;
    canvas.height = height;

    context.clearRect(0, 0, width, height);
    context.strokeStyle = 'rgba(148, 163, 184, 0.14)';
    context.lineWidth = 1 * scale;
    for (let i = 1; i < 4; i += 1) {
      const y = (height / 4) * i;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(width, y);
      context.stroke();
    }

    const thresholdY = height - (threshold / channelDepth) * height;
    context.strokeStyle = 'rgba(245, 158, 11, 0.75)';
    context.setLineDash([6 * scale, 6 * scale]);
    context.beginPath();
    context.moveTo(0, thresholdY);
    context.lineTo(width, thresholdY);
    context.stroke();
    context.setLineDash([]);

    const gradient = context.createLinearGradient(0, 0, 0, height);
    gradient.addColorStop(0, '#38bdf8');
    gradient.addColorStop(1, '#14b8a6');
    context.strokeStyle = gradient;
    context.lineWidth = 3 * scale;
    context.lineJoin = 'round';
    context.lineCap = 'round';
    context.beginPath();
    history.forEach((value, index) => {
      const x = (index / (history.length - 1)) * width;
      const y = height - (value / channelDepth) * height;
      if (index === 0) context.moveTo(x, y);
      else context.lineTo(x, y);
    });
    context.stroke();
  }, [channelDepth, history, threshold]);

  const waterPercent = clamp((level / channelDepth) * 100, 0, 100);
  const waterY = 220 - (level / channelDepth) * 170;
  const status = level >= threshold ? 'Warning' : level >= threshold - 8 ? 'Watch' : 'Safe';
  const selectedCode = guideTab === 'sketch' ? sketch : wiringGuide;

  return (
    <main className="min-h-screen bg-[#071014] text-slate-100">
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#071014]/92 backdrop-blur">
        <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-4 md:flex-row md:items-center md:justify-between lg:px-6">
          <div className="flex items-center gap-3">
            <div className="grid h-11 w-11 place-items-center rounded-lg bg-cyan-500 text-slate-950 shadow-lg shadow-cyan-500/20">
              <Droplets size={24} strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">Smart Drainage Monitor</h1>
              <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-400">Industrial IoT Interface</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <span className={`status-pill ${telemetryState === 'live' ? 'status-pill-live' : telemetryState === 'stale' ? 'status-pill-stale' : 'status-pill-sim'}`}>
              <Radio size={14} />
              {isConnected ? `${telemetryLabel}: ${deviceName || 'BLE device'}` : 'Simulation Active'}
            </span>
            <button className="primary-button" onClick={isConnected ? disconnectBluetooth : connectBluetooth}>
              {isConnected ? <Power size={17} /> : <Bluetooth size={17} />}
              {isConnected ? 'Disconnect' : 'Connect Bluetooth'}
            </button>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl grid-cols-1 gap-5 px-4 py-5 lg:grid-cols-[360px_1fr] lg:px-6">
        <aside className="space-y-5">
          <section className="panel">
            <div className="panel-heading">
              <Settings size={19} className="text-cyan-300" />
              <h2>Device Configuration</h2>
            </div>

            <label className="field-label" htmlFor="profile">
              BLE Profile
            </label>
            <select id="profile" className="control" value={profile} onChange={(event) => setProfile(event.target.value as BleProfileKey)}>
              <option value="hm10">{BLE_PROFILES.hm10.label}</option>
              <option value="nus">{BLE_PROFILES.nus.label}</option>
              <option value="custom">Custom UUIDs</option>
            </select>

            <label className="check-row">
              <input type="checkbox" checked={scanAllDevices} onChange={(event) => setScanAllDevices(event.target.checked)} />
              <span>Show all nearby BLE devices during pairing</span>
            </label>

            {profile === 'custom' && (
              <div className="stack">
                <input className="control mono" placeholder="Service UUID" value={customServiceUuid} onChange={(event) => setCustomServiceUuid(event.target.value)} />
                <input className="control mono" placeholder="TX notify characteristic UUID" value={customTxUuid} onChange={(event) => setCustomTxUuid(event.target.value)} />
                <input className="control mono" placeholder="RX write characteristic UUID" value={customRxUuid} onChange={(event) => setCustomRxUuid(event.target.value)} />
              </div>
            )}

            <div className="range-row">
              <label className="field-label" htmlFor="threshold">
                Automatic Trigger
              </label>
              <span>{threshold} cm</span>
            </div>
            <input
              id="threshold"
              className="range"
              type="range"
              min="10"
              max={Math.max(10, channelDepth - 2)}
              value={threshold}
              onChange={(event) => setThreshold(Number(event.target.value))}
            />

            <label className="field-label" htmlFor="channel-depth">
              Channel Depth
            </label>
            <input
              id="channel-depth"
              className="control"
              type="number"
              min="20"
              max="300"
              value={channelDepth}
              onChange={(event) => setChannelDepth(clamp(Number(event.target.value) || 60, 20, 300))}
            />

            <div className="field-label">Arduino Sends</div>
            <div className="segmented flush" aria-label="Arduino measurement format">
              <button className={measurementMode === 'level' ? 'active' : ''} onClick={() => setMeasurementMode('level')}>
                Water Level
              </button>
              <button className={measurementMode === 'distance' ? 'active' : ''} onClick={() => setMeasurementMode('distance')}>
                Sensor Distance
              </button>
            </div>

            <div className="segmented" aria-label="Control mode">
              <button className={mode === 'manual' ? 'active' : ''} onClick={() => setMode('manual')}>
                Manual
              </button>
              <button className={mode === 'auto' ? 'active' : ''} onClick={() => setMode('auto')}>
                Smart Auto
              </button>
            </div>
          </section>

          <section className="panel">
            <div className="panel-heading">
              <Info size={19} className="text-cyan-300" />
              <h2>System Parameters</h2>
            </div>
            <dl className="stat-list">
              <div>
                <dt>Bluetooth</dt>
                <dd>{telemetryLabel}</dd>
              </div>
              <div>
                <dt>Protocol</dt>
                <dd>{activeProfile.protocol}</dd>
              </div>
              <div>
                <dt>Last Raw</dt>
                <dd>{lastRawMeasurement.toFixed(1)} cm</dd>
              </div>
              <div>
                <dt>Last Packet</dt>
                <dd>{lastTelemetryAt ? `${Math.round((Date.now() - lastTelemetryAt) / 1000)}s ago` : '-'}</dd>
              </div>
              <div>
                <dt>Frame</dt>
                <dd className="mono">distance,status</dd>
              </div>
            </dl>
          </section>

          <section className="panel chart-panel">
            <div className="panel-heading">
              <Activity size={19} className="text-cyan-300" />
              <h2>Level History</h2>
            </div>
            <canvas ref={chartRef} className="history-chart" aria-label="Recent water level chart" />
          </section>
        </aside>

        <section className="space-y-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            <article className="metric-panel">
              <div className="metric-topline">
                <span>Real-time telemetry</span>
                <Waves size={22} className="text-cyan-300" />
              </div>
              <div className="metric-value">
                {level.toFixed(1)}
                <span>cm</span>
              </div>
              <div className={`health health-${status.toLowerCase()}`}>
                {status === 'Safe' ? <CheckCircle2 size={16} /> : <AlertTriangle size={16} />}
                Level {status}
              </div>
              <div className="progress-track">
                <div style={{width: `${waterPercent}%`}} />
              </div>
            </article>

            <article className="metric-panel">
              <div className="metric-topline">
                <span>Operational status</span>
                <ShieldAlert size={22} className={pumpOn ? 'text-emerald-300' : 'text-slate-400'} />
              </div>
              <div className="pump-row">
                <span className={pumpOn ? 'pump-light on' : 'pump-light'} />
                <strong>{pumpOn ? 'ON' : 'OFF'}</strong>
              </div>
              <p className="text-sm font-semibold uppercase tracking-[0.16em] text-slate-400">{pumpOn ? 'Pump active' : 'Pump inactive'}</p>
              <button className={pumpOn ? 'danger-button' : 'secondary-button'} onClick={() => setPump(!pumpOn, 'Manual override')}>
                <Power size={18} />
                {pumpOn ? 'Turn Pump Off' : 'Turn Pump On'}
              </button>
            </article>
          </div>

          <section className="visual-panel">
            <div className="visual-header">
              <div>
                <h2>Cross-Section Drainage Profile</h2>
                <p>Ultrasonic level translation with threshold and gate status</p>
              </div>
              {level >= threshold && (
                <span className="alert-badge">
                  <AlertTriangle size={15} />
                  Flood Level Warning
                </span>
              )}
            </div>

            <svg viewBox="0 0 640 260" className="drainage-svg" role="img" aria-label="Drainage channel water level visualization">
              <rect width="640" height="260" rx="8" fill="#071014" />
              {[55, 105, 155, 205].map((lineY) => (
                <line key={lineY} x1="78" x2="562" y1={lineY} y2={lineY} stroke="#20313a" strokeDasharray="5 7" />
              ))}
              <rect x="0" y="0" width="78" height="260" fill="#111c21" />
              <rect x="562" y="0" width="78" height="260" fill="#111c21" />
              <line x1="78" x2="78" y1="0" y2="260" stroke="#48616d" strokeWidth="2" />
              <line x1="562" x2="562" y1="0" y2="260" stroke="#48616d" strokeWidth="2" />
              <g transform="translate(320 16)">
                <rect x="-44" y="0" width="88" height="8" rx="2" fill="#64748b" />
                <rect x="-18" y="8" width="36" height="12" fill="#475569" />
                <circle cx="-13" cy="31" r="9" fill="#0f172a" stroke="#22d3ee" strokeWidth="2" />
                <circle cx="13" cy="31" r="9" fill="#0f172a" stroke="#22d3ee" strokeWidth="2" />
                <path d="M -34 51 Q 0 72 34 51" fill="none" stroke="#22d3ee" strokeWidth="2" opacity={pumpOn ? 0.7 : 0.28} />
                <path d="M -48 70 Q 0 98 48 70" fill="none" stroke="#22d3ee" strokeWidth="2" opacity={pumpOn ? 0.45 : 0.18} />
              </g>
              <line x1="78" x2="562" y1={220 - (threshold / channelDepth) * 170} y2={220 - (threshold / channelDepth) * 170} stroke="#f59e0b" strokeWidth="2" strokeDasharray="8 7" />
              <text x="548" y={214 - (threshold / channelDepth) * 170} fill="#fbbf24" fontSize="12" textAnchor="end">
                Trigger {threshold}cm
              </text>
              <path
                d={`M 78 ${waterY} Q 190 ${waterY - (pumpOn ? 8 : 4)} 320 ${waterY} T 562 ${waterY} L 562 220 L 78 220 Z`}
                fill="url(#waterGradient)"
              />
              <path d={`M 78 ${waterY} Q 190 ${waterY - 8} 320 ${waterY} T 562 ${waterY}`} fill="none" stroke="#7dd3fc" strokeWidth="3" opacity="0.8" />
              <g transform={pumpOn ? 'translate(0 -28)' : 'translate(0 0)'}>
                <rect x="502" y="202" width="78" height="18" rx="4" fill="#94a3b8" />
                <rect x="522" y="180" width="38" height="22" rx="3" fill="#64748b" />
              </g>
              {pumpOn && (
                <path d="M 580 211 C 600 211 607 229 629 229" fill="none" stroke="#38bdf8" strokeWidth="10" strokeLinecap="round" opacity="0.75" />
              )}
              <defs>
                <linearGradient id="waterGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#38bdf8" stopOpacity="0.72" />
                  <stop offset="100%" stopColor="#0d9488" stopOpacity="0.88" />
                </linearGradient>
              </defs>
            </svg>

            <div className="sim-controls">
              <label>
                <span>Simulator Level</span>
                <input
                  className="range"
                  type="range"
                  min="2"
                  max={Math.max(2, channelDepth - 2)}
                  value={Math.round(level)}
                  disabled={isConnected}
                  onChange={(event) => setLevel(Number(event.target.value))}
                />
              </label>
              <button className={rainActive ? 'toggle-button active' : 'toggle-button'} disabled={isConnected} onClick={() => setRainActive((value) => !value)}>
                <CloudRain size={17} />
                Rain Event
              </button>
              <button className={releaseActive ? 'toggle-button active green' : 'toggle-button'} disabled={isConnected} onClick={() => setReleaseActive((value) => !value)}>
                <Droplets size={17} />
                Passive Release
              </button>
            </div>
          </section>

          <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_420px]">
            <section className="panel">
              <div className="panel-heading">
                <Terminal size={19} className="text-cyan-300" />
                <h2>Event Console</h2>
                <button className="ghost-button ml-auto" onClick={() => setLogs([])}>
                  Clear
                </button>
              </div>
              <div className="log-list">
                {logs.map((log) => (
                  <div key={log.id} className={`log-line log-${log.kind}`}>
                    <span>{log.time}</span>
                    <p>{log.message}</p>
                  </div>
                ))}
              </div>
            </section>

            <section className="panel">
              <div className="panel-heading">
                <CircuitBoard size={19} className="text-cyan-300" />
                <h2>Arduino Setup</h2>
                <button
                  className="ghost-button ml-auto"
                  onClick={() => {
                    void navigator.clipboard.writeText(selectedCode);
                    setCopied(true);
                    window.setTimeout(() => setCopied(false), 1400);
                  }}
                >
                  <Copy size={15} />
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
              <div className="segmented compact">
                <button className={guideTab === 'sketch' ? 'active' : ''} onClick={() => setGuideTab('sketch')}>
                  Sketch
                </button>
                <button className={guideTab === 'wiring' ? 'active' : ''} onClick={() => setGuideTab('wiring')}>
                  Wiring
                </button>
              </div>
              <pre className="code-block">{selectedCode}</pre>
            </section>
          </div>
        </section>
      </div>
    </main>
  );
}

export default App;
