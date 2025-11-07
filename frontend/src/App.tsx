import { useState, useRef, useEffect } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import './App.css';

const API_BASE = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:5000';

interface AttendanceRecord {
  timestamp: string;
  roll_number: string;
  status: string;
  distance: string;
  enrolled?: boolean;
}

interface ScanResult {
  ok: boolean;
  status: string;
  roll_no: string;
  distance?: number | string;
  timestamp?: string;
  enrolled?: boolean;
}

// Helper function to safely format distance
const formatDistance = (distance: number | string | undefined): string => {
  if (distance === undefined || distance === null || distance === '') {
    return '';
  }
  const num = typeof distance === 'string' ? parseFloat(distance) : distance;
  if (isNaN(num)) {
    return '';
  }
  return num.toFixed(3);
};

function App() {
  const [isScanning, setIsScanning] = useState(false);
  const [currentBarcode, setCurrentBarcode] = useState('');
  const [isRecording, setIsRecording] = useState(false);
  const [lastResult, setLastResult] = useState<ScanResult | null>(null);
  const [showAttendance, setShowAttendance] = useState(false);
  const [attendanceRecords, setAttendanceRecords] = useState<AttendanceRecord[]>([]);
  const [statusMessages, setStatusMessages] = useState<string[]>([]);
  const [sessionRecords, setSessionRecords] = useState<AttendanceRecord[]>([]);
  const [queueSize, setQueueSize] = useState(0);
  const [isUploading, setIsUploading] = useState(false);

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<Html5Qrcode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordedChunksRef = useRef<Blob[]>([]);
  const scanningRef = useRef(false);
  const lastScannedRef = useRef<{ barcode: string; timestamp: number } | null>(null);
  const processingRef = useRef(false);
  const uploadQueueRef = useRef<Array<{ barcode: string; blob: Blob }>>([]);
  const isUploadingRef = useRef(false);

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
      
      setSessionRecords([]);
      console.log('🆕 New session started - records cleared');
      
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
      
      scannerRef.current = new Html5Qrcode("reader");
      
      await scannerRef.current.start(
        { facingMode: "user" },
        {
          fps: 20,
          qrbox: { width: 400, height: 400 },
          aspectRatio: 1.0
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
          
          const now = Date.now();
          if (lastScannedRef.current && 
              lastScannedRef.current.barcode === decodedText && 
              now - lastScannedRef.current.timestamp < 5000) {
            console.log('⏭️ Skipping duplicate');
            return;
          }
          
          if (/^\d{9}$/.test(decodedText)) {
            console.log('✅ Valid 9-digit barcode');
            processingRef.current = true;
            lastScannedRef.current = { barcode: decodedText, timestamp: now };
            
            setCurrentBarcode(decodedText);
            addStatusMessage(`✅ Valid: ${decodedText} - Recording...`);
            
            recordVideo(decodedText);
            
            setTimeout(() => {
              processingRef.current = false;
              console.log('🔄 Ready for next barcode');
            }, 1000);
          } else {
            console.log('⚠️ Invalid format:', decodedText);
            addStatusMessage(`⚠️ Invalid: ${decodedText} (need 9 digits)`);
          }
        },
        (_errorMessage) => {
          // Ignore - normal when no barcode visible
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
      console.error('❌ No stream available');
      addStatusMessage('❌ No camera stream');
      return;
    }
    
    console.log('🎥 STARTING RECORDING for barcode:', barcode);
    addStatusMessage('🎥 Recording 2-second video...');
    setIsRecording(true);
    recordedChunksRef.current = [];
    
    try {
      const mediaRecorder = new MediaRecorder(streamRef.current, {
        mimeType: 'video/webm;codecs=vp8'
      });
      
      mediaRecorderRef.current = mediaRecorder;
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data);
        }
      };
      
      mediaRecorder.onstop = async () => {
        const blob = new Blob(recordedChunksRef.current, { type: 'video/webm' });
        console.log('📦 Video blob created:', blob.size, 'bytes');
        
        if (blob.size === 0) {
          console.error('❌ Empty video');
          addStatusMessage('❌ Recording failed');
          setIsRecording(false);
          return;
        }
        
        // Add to queue
        uploadQueueRef.current.push({ barcode, blob });
        setQueueSize(uploadQueueRef.current.length);
        console.log('📋 Added to queue. Size:', uploadQueueRef.current.length);
        addStatusMessage(`📋 Queued: ${barcode}`);
        
        setIsRecording(false);
        
        // Process queue
        if (!isUploadingRef.current) {
          processUploadQueue();
        }
      };
      
      mediaRecorder.onerror = (event) => {
        console.error('❌ MediaRecorder error:', event);
        setIsRecording(false);
      };
      
      mediaRecorder.start();
      console.log('✅ Recording started');
      
      setTimeout(() => {
        if (mediaRecorder.state === 'recording') {
          mediaRecorder.stop();
        }
      }, 2000);
      
    } catch (error) {
      console.error('❌ Recording error:', error);
      addStatusMessage(`❌ Recording error: ${error}`);
      setIsRecording(false);
    }
  };

  const processUploadQueue = async () => {
    if (uploadQueueRef.current.length === 0) {
      isUploadingRef.current = false;
      setIsUploading(false);
      setQueueSize(0);
      console.log('✅ Queue empty');
      return;
    }
    
    if (isUploadingRef.current) {
      return;
    }
    
    isUploadingRef.current = true;
    setIsUploading(true);
    
    while (uploadQueueRef.current.length > 0) {
      const item = uploadQueueRef.current.shift();
      setQueueSize(uploadQueueRef.current.length);
      
      if (item) {
        console.log('📤 Processing:', item.barcode, '(Remaining:', uploadQueueRef.current.length, ')');
        await uploadVideo(item.barcode, item.blob);
      }
    }
    
    isUploadingRef.current = false;
    setIsUploading(false);
    setQueueSize(0);
    console.log('✅ All uploads complete');
  };

  const uploadVideo = async (barcode: string, videoBlob: Blob) => {
    try {
      console.log('📤 UPLOADING:', barcode, videoBlob.size, 'bytes');
      addStatusMessage(`📤 Uploading ${barcode}...`);
      
      const formData = new FormData();
      formData.append('barcode', barcode);
      formData.append('video', videoBlob, `${barcode}.webm`);
      
      const response = await fetch(`${API_BASE}/api/mark_attendance`, {
        method: 'POST',
        body: formData
      });
      
      console.log('📥 Response:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }
      
      const result: ScanResult = await response.json();
      console.log('📥 Result:', result);
      
      setLastResult(result);
      
      // Add to session records AFTER successful upload
      const newRecord: AttendanceRecord = {
        timestamp: result.timestamp || new Date().toLocaleString(),
        roll_number: result.roll_no,
        status: result.status,
        distance: formatDistance(result.distance),
        enrolled: result.enrolled || false
      };
      setSessionRecords(prev => [...prev, newRecord]);
      console.log('📝 Added to session records');
      
      const statusEmoji: Record<string, string> = {
        'VALID': '✅',
        'FACE_MISMATCH': '❌',
        'NO_RECORD': '⚠️',
        'NO_FACE': '⚠️',
        'INVALID_FORMAT': '❌',
        'ERROR': '❌'
      };
      
      const emoji = statusEmoji[result.status] || '❓';
      const distanceStr = formatDistance(result.distance);
      const distanceDisplay = distanceStr ? ` (${distanceStr})` : '';
      const enrolledStr = result.enrolled ? ' 🆕 NEW ENROLLMENT' : '';
      addStatusMessage(`${emoji} ${result.status} - ${result.roll_no}${distanceDisplay}${enrolledStr}`);
      
      console.log('✅ Attendance marked');
      setCurrentBarcode('');
      
    } catch (error) {
      console.error('❌ UPLOAD ERROR:', error);
      addStatusMessage(`❌ Upload failed: ${error}`);
    }
  };

  const cleanup = async () => {
    console.log('🧹 Cleaning up...');
    
    scanningRef.current = false;
    processingRef.current = false;
    
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
    
    if (scannerRef.current) {
      try {
        await scannerRef.current.stop();
        console.log('✅ Scanner stopped');
      } catch (error) {
        console.error('Error stopping scanner:', error);
      }
      scannerRef.current = null;
    }
    
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => {
        console.log('⏹️ Stopping track:', track.kind);
        track.stop();
      });
      streamRef.current = null;
      console.log('✅ Camera stream stopped');
    }
    
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
      
      // Show session records
      setAttendanceRecords(sessionRecords);
      setShowAttendance(true);
      addStatusMessage(`✅ Showing ${sessionRecords.length} records from this session`);
      
    } catch (error) {
      console.error('❌ Error:', error);
      addStatusMessage('❌ Failed to fetch attendance');
    }
  };

  const closeAttendanceModal = async () => {
    setShowAttendance(false);
    
    // Clear backend records
    try {
      console.log('🗑️  Clearing backend...');
      const response = await fetch(`${API_BASE}/api/clear_attendance`, {
        method: 'POST'
      });
      
      if (response.ok) {
        console.log('✅ Backend cleared');
        addStatusMessage('🗑️  Records cleared');
      }
    } catch (error) {
      console.error('❌ Error:', error);
    }
  };

  const exportToCSV = () => {
    if (attendanceRecords.length === 0) {
      alert('No records to export');
      return;
    }
    
    const headers = ['Timestamp', 'Roll Number', 'Status', 'Distance', 'Enrolled'];
    const rows = attendanceRecords.map(r => [
      r.timestamp,
      r.roll_number,
      r.status,
      r.distance,
      r.enrolled ? 'Yes' : 'No'
    ]);
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.join(','))
    ].join('\n');
    
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `attendance_${new Date().toISOString().split('T')[0]}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
    
    console.log('📥 Exported', attendanceRecords.length, 'records');
    addStatusMessage(`📥 Exported ${attendanceRecords.length} records`);
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
        <div id="reader" style={{ width: '100%' }}></div>
        
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
        
        {(queueSize > 0 || isUploading) && (
          <div style={{ 
            background: '#fef3c7', 
            padding: '10px', 
            borderRadius: '5px', 
            marginBottom: '10px',
            fontSize: '0.9rem',
            color: '#92400e'
          }}>
            {isUploading ? '⏳ Processing...' : '📋'} {queueSize} {queueSize === 1 ? 'upload' : 'uploads'} in queue
          </div>
        )}
        
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
              Distance: {formatDistance(lastResult.distance)}
            </div>
          )}
        </div>
      )}

      {showAttendance && (
        <div className="attendance-modal" onClick={closeAttendanceModal}>
          <div className="attendance-content" onClick={(e) => e.stopPropagation()}>
            <div className="attendance-header">
              <h2>Attendance Records - This Session ({attendanceRecords.length})</h2>
              <div>
                {attendanceRecords.length > 0 && (
                  <button onClick={exportToCSV} className="btn btn-info" style={{ marginRight: '10px' }}>
                    📥 Export CSV
                  </button>
                )}
                <button onClick={closeAttendanceModal} className="close-btn">✕</button>
              </div>
            </div>
            
            <div className="attendance-table-container">
              {attendanceRecords.length === 0 ? (
                <div className="no-records">No attendance recorded in this session yet</div>
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
                        <td>
                          <strong>{record.roll_number}</strong>
                          {record.enrolled && (
                            <span style={{ 
                              marginLeft: '8px', 
                              fontSize: '0.85rem', 
                              color: '#2563eb',
                              fontWeight: 'bold'
                            }}>
                              🆕 NEW
                            </span>
                          )}
                        </td>
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
            
            <div style={{ padding: '20px', textAlign: 'center', color: '#6b7280', fontSize: '0.9rem' }}>
              ℹ️ Records will be cleared from database when you close this window
              {queueSize > 0 && (
                <div style={{ marginTop: '10px', color: '#f59e0b' }}>
                  ⚠️ Note: {queueSize} upload{queueSize > 1 ? 's' : ''} still processing in queue
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;