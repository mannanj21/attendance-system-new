import { useState, useRef, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:5000';

interface AttendanceRecord {
  timestamp: string;
  roll_number: string;
  status: string;
  distance: string;
}

interface ScanResult {
  ok: boolean;
  status: string;
  roll_no: string;
  distance?: number;
  timestamp?: string;
}

function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [currentBarcode, setCurrentBarcode] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [statusMessages, setStatusMessages] = useState<string[]>([]);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const scanningRef = useRef(false);
  const lastScannedRef = useRef<{ barcode: string; timestamp: number } | null>(null);
  const processingRef = useRef(false);

  useEffect(() => {
    return () => {
      console.log('Component unmounting, cleaning up...');
      cleanup();
    };
  }, []);

  const addStatusMessage = (message: string) => {
    console.log(message);
    setStatusMessages(prev => {
      const newMessages = [...prev, `${new Date().toLocaleTimeString()}: ${message}`];
      return newMessages.slice(-5);
    });
  };

  const startScanning = async () => {
    try {
      addStatusMessage('Starting camera...');
      
      // Get camera stream for recording
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'user', width: 1280, height: 720 }
      });
      
      console.log('✅ Camera stream acquired');
      streamRef.current = stream;
      
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
        console.log('✅ Video element playing');
      }
      
      setIsScanning(true);
      scanningRef.current = true;
      addStatusMessage('📷 Initializing barcode scanner...');
      
      // Initialize Html5Qrcode scanner
      scannerRef.current = new Html5Qrcode("reader");
      
      // Start scanning
      await scannerRef.current.start(
        { facingMode: "user" },
        {
          fps: 10,
          qrbox: { width: 250, height: 250 }
        },
        (decodedText, decodedResult) => {
          if (!scanningRef.current || processingRef.current) {
            return;
          }
          
          console.log('🎯 BARCODE DETECTED!');
          console.log('   Text:', decodedText);
          console.log('   Format:', decodedResult.result.format?.formatName);
          console.log('   Length:', decodedText.length);
          
          addStatusMessage(`🎯 Detected: ${decodedText}`);
          
          // Check for duplicates within 5 seconds
          const now = Date.now();
          if (lastScannedRef.current && 
              lastScannedRef.current.barcode === decodedText && 
              now - lastScannedRef.current.timestamp < 5000) {
            console.log('⏭️ Skipping duplicate (scanned', ((now - lastScannedRef.current.timestamp) / 1000).toFixed(1), 'seconds ago)');
            return;
          }
          
          // Validate 9 digits
          if (/^\d{9}$/.test(decodedText)) {
            console.log('✅ Valid 9-digit barcode');
            processingRef.current = true;
            lastScannedRef.current = { barcode: decodedText, timestamp: now };
            
            setCurrentBarcode(decodedText);
            addStatusMessage(`✅ Valid: ${decodedText} - Recording...`);
            
            // Record video and upload
            recordVideo(decodedText);
          } else {
            console.log('⚠️ Invalid barcode format:', decodedText, '(must be exactly 9 digits)');
            addStatusMessage(`⚠️ Invalid: ${decodedText} (need 9 digits)`);
          }
        },
        (errorMessage) => {
          // Errors are normal when no barcode is visible
          // Don't log them to avoid console spam
        }
      );
      
      console.log('✅ Barcode scanner started');
      addStatusMessage('✅ Scanner ready. Show barcode to camera...');
      
    } catch (error) {
      console.error('❌ Error:', error);
      addStatusMessage(`❌ Error: ${error}`);
    }
  };

  const recordVideo = async (barcode: string) => {
    if (!streamRef.current) {
      console.error('❌ No stream available for recording');
      processingRef.current = false;
      addStatusMessage('❌ No camera stream');
      return;
    }
    
    console.log('🎥 STARTING RECORDING for barcode:', barcode);
    addStatusMessage('🎥 Recording 4-second video...');
    setIsRecording(true);
    recordedChunksRef.current = [];
    
    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: 'video/webm;codecs=vp8'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log('📦 Video chunk:', event.data.size, 'bytes');
          recordedChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        console.log('⏹️ Recording stopped. Total chunks:', recordedChunksRef.current.length);
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        console.log('📦 Video blob created:', blob.size, 'bytes');
        
        if (blob.size === 0) {
          console.error('❌ Video blob is empty!');
          addStatusMessage('❌ Recording failed - empty video');
          processingRef.current = false;
          setIsRecording(false);
          return;
        }
        
        await uploadVideo(barcode, blob);
        setIsRecording(false);
      };
      
      mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
        addStatusMessage('❌ Recording error');
        setIsRecording(false);
        processingRef.current = false;
      };
      
      mediaRecorder.start();
      console.log('✅ MediaRecorder started, state:', mediaRecorder.state);
      
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          console.log('⏱️ 4 seconds elapsed, stopping recording...');
          mediaRecorder.stop();
        } else {
          console.log('⚠️ MediaRecorder not recording, state:', mediaRecorder.state);
        }
      }, 4000);
      
    } catch (error) {
      console.error('❌ Recording error:', error);
      addStatusMessage(`❌ Recording error: ${error}`);
      setIsRecording(false);
      processingRef.current = false;
    }
  };

  const uploadVideo = async (barcode: string, videoBlob: Blob) => {
    try {
      console.log('📤 UPLOADING VIDEO');
      console.log('   Barcode:', barcode);
      console.log('   Video size:', videoBlob.size, 'bytes');
      console.log('   API URL:', `${API_BASE}/api/mark_attendance`);
      
      addStatusMessage(`📤 Uploading ${barcode}...`);
      
      const formData = new FormData();
      formData.append('barcode', barcode);
      formData.append('video', videoBlob, `${barcode}.webm`);
      
      const response = await fetch(`${API_BASE}/api/mark_attendance`, {
        method: 'POST',
        body: formData
      });
      
      console.log('📥 Response status:', response.status);
      console.log('📥 Response ok:', response.ok);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ Response error:', errorText);
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const result: ScanResult = await response.json();
      console.log('📥 Response data:', result);
      
      setLastResult(result);
      
      const statusEmoji: Record<string, string> = {
        'VALID': '✅',
        'FACE_MISMATCH': '❌',
        'NO_RECORD': '⚠️',
        'NO_FACE': '⚠️',
        'INVALID_FORMAT': '❌',
        'ERROR': '❌'
      };
      
      const emoji = statusEmoji[result.status] || '❓';
      const distanceStr = result.distance !== undefined ? ` (${result.distance.toFixed(3)})` : '';
      addStatusMessage(`${emoji} ${result.status} - ${result.roll_no}${distanceStr}`);
      
      console.log('✅ Attendance marked successfully');
      console.log('⏭️ Waiting 2 seconds before next scan...');
      
      setTimeout(() => {
        setCurrentBarcode('');
        processingRef.current = false;
        if (scanningRef.current) {
          addStatusMessage('👀 Ready for next scan...');
        }
      }, 2000);
      
    } catch (error) {
      console.error('❌ UPLOAD ERROR:', error);
      addStatusMessage(`❌ Upload failed: ${error}`);
      
      setTimeout(() => {
        processingRef.current = false;
        if (scanningRef.current) {
          addStatusMessage('🔄 Retrying scanner...');
        }
      }, 2000);
    }
  };

  const cleanup = async () => {
    console.log('🧹 Cleaning up...');
    
    scanningRef.current = false;
    processingRef.current = false;
    
    // Stop media recorder
    if (mediaRecorderRef.current) {
      try {
        if (mediaRecorderRef.current.state === 'recording') {
          mediaRecorderRef.current.stop();
        }
        mediaRecorderRef.current = null;
      } catch (error) {
        console.error('Error stopping recorder:', error);
      }
    }
    
    // Stop Html5Qrcode scanner
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        console.log('✅ Scanner stopped');
      } catch (error) {
        console.error('Error stopping scanner:', error);
      }
      scannerRef.current = null;
    }
    
    // Stop camera stream
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        console.log('⏹️ Stopping track:', track.kind);
        track.stop();
      });
      streamRef.current = null;
      console.log('✅ Camera stream stopped');
    }
    
    // Clear video element
    if (videoRef.current) {
      videoRef.current.srcObject = null;
      videoRef.current.pause();
    }
    
    console.log('✅ Cleanup complete');
  };

  const stopScanning = async () => {
    console.log('🛑 Stopping...');
    setIsScanning(false);
    setCurrentBarcode('');
    setIsRecording(false);
    await cleanup();
    addStatusMessage('⏹️ Stopped');
  };

  const fetchAttendance = async () => {
    try {
      addStatusMessage('📋 Fetching attendance...');
      const response = await fetch(`${API_BASE}/api/attendance`);
      const data = await response.json();
      
      if (data.ok) {
        setAttendanceRecords(data.records);
        setShowAttendance(true);
        addStatusMessage(`✅ Loaded ${data.records.length} records`);
      }
    } catch (error) {
      console.error('❌ Error:', error);
      addStatusMessage('❌ Failed to fetch attendance');
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'VALID': return '#10b981';
      case 'FACE_MISMATCH': return '#ef4444';
      case 'NO_RECORD': return '#f59e0b';
      case 'NO_FACE': return '#f59e0b';
      default: return '#6b7280';
    }
  };

  return (
    <div className="app">
      <header className="app-header">
        <h1>📸 Attendance Scanner</h1>
      </header>

      <div className="controls">
        <button 
          onClick={startScanning} 
          disabled={isScanning}
          className="btn btn-primary"
        >
          {isScanning ? '🎥 Scanning...' : '▶️ Start'}
        </button>
        
        <button 
          onClick={stopScanning} 
          disabled={!isScanning}
          className="btn btn-danger"
        >
          ⏹️ Stop
        </button>
        
        <button 
          onClick={fetchAttendance}
          className="btn btn-info"
        >
          📋 View Attendance
        </button>
      </div>

      <div className="video-container">
        {/* Html5Qrcode creates its own video element */}
        <div id="reader" style={{ width: '100%' }}></div>
        
        {/* Hidden video for recording */}
        <video 
          ref={videoRef} 
          autoPlay 
          playsInline
          muted
          style={{ display: 'none' }}
        />
        
        {isScanning && !isRecording && (
          <div className="scanning-indicator">
            🔍 Scanning for barcode...
          </div>
        )}
        
        {isRecording && (
          <div className="recording-indicator">
            🔴 Recording...
          </div>
        )}
      </div>

      <div className="status-console">
        <h3>📊 Status Console</h3>
        <div className="console-messages">
          {statusMessages.length === 0 ? (
            <div className="console-message">Ready to start...</div>
          ) : (
            statusMessages.map((msg, idx) => (
              <div key={idx} className="console-message">{msg}</div>
            ))
          )}
        </div>
      </div>

      {currentBarcode && (
        <div className="status-panel">
          <div className="barcode-display">
            Current Roll: <strong>{currentBarcode}</strong>
          </div>
          {lastResult && lastResult.distance !== undefined && (
            <div className="distance-display">
              Distance: {lastResult.distance.toFixed(3)}
            </div>
          )}
        </div>
      )}

      {showAttendance && (
        <div className="attendance-modal" onClick={() => setShowAttendance(false)}>
          <div className="attendance-content" onClick={(e) => e.stopPropagation()}>
            <div className="attendance-header">
              <h2>Attendance Records ({attendanceRecords.length})</h2>
              <button onClick={() => setShowAttendance(false)} className="close-btn">✕</button>
            </div>
            
            <div className="attendance-table-container">
              {attendanceRecords.length === 0 ? (
                <div className="no-records">No records yet</div>
              ) : (
                <table className="attendance-table">
                  <thead>
                    <tr>
                      <th>Timestamp</th>
                      <th>Roll Number</th>
                      <th>Status</th>
                      <th>Distance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {attendanceRecords.map((record, index) => (
                      <tr key={index}>
                        <td>{record.timestamp}</td>
                        <td><strong>{record.roll_number}</strong></td>
                        <td>
                          <span 
                            className="status-badge"
                            style={{ backgroundColor: getStatusColor(record.status) }}
                          >
                            {record.status}
                          </span>
                        </td>
                        <td>{record.distance || '-'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;