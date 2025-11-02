#!/usr/bin/env python3
"""
Flask backend for web-based attendance system
Handles video upload, face verification, and attendance logging
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import csv
from datetime import datetime
from werkzeug.utils import secure_filename
from barcode_scanner import verify_face

app = Flask(__name__)
CORS(app)  # Enable CORS for React frontend

# Configuration
UPLOAD_FOLDER = '/tmp/attendance_videos'
SCANS_CSV = 'scans.csv'
ALLOWED_EXTENSIONS = {'webm', 'mp4', 'avi', 'mov'}

os.makedirs(UPLOAD_FOLDER, exist_ok=True)

# Initialize scans.csv if it doesn't exist
if not os.path.exists(SCANS_CSV):
    with open(SCANS_CSV, 'w', newline='') as f:
        writer = csv.writer(f)
        writer.writerow(['timestamp', 'roll_number', 'status', 'distance'])


def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in ALLOWED_EXTENSIONS


@app.route('/api/mark_attendance', methods=['POST'])
def mark_attendance():
    """
    Accept barcode and video file, verify face, log result
    """
    try:
        print("\n" + "="*50)
        print("📥 NEW ATTENDANCE REQUEST")
        print("="*50)
        
        # Validate request
        if 'barcode' not in request.form:
            print("❌ Missing barcode parameter")
            return jsonify({'error': 'Missing barcode parameter'}), 400
        
        if 'video' not in request.files:
            print("❌ Missing video file")
            return jsonify({'error': 'Missing video file'}), 400
        
        barcode = request.form['barcode'].strip()
        video_file = request.files['video']
        
        print(f"📋 Barcode: {barcode}")
        print(f"📹 Video filename: {video_file.filename}")
        print(f"📦 Video size: {video_file.content_length or 'unknown'} bytes")
        
        if video_file.filename == '':
            print("❌ Empty video filename")
            return jsonify({'error': 'Empty video filename'}), 400
        
        # Save video temporarily
        filename = secure_filename(f"{barcode}_{datetime.now().strftime('%Y%m%d_%H%M%S')}.webm")
        video_path = os.path.join(UPLOAD_FOLDER, filename)
        video_file.save(video_path)
        
        print(f"💾 Video saved to: {video_path}")
        print(f"📊 File size on disk: {os.path.getsize(video_path)} bytes")
        
        # Verify face
        print(f"🔍 Starting face verification for {barcode}...")
        result = verify_face(barcode, video_path)
        
        print(f"✅ Verification complete:")
        print(f"   Status: {result['status']}")
        print(f"   OK: {result['ok']}")
        if 'distance' in result:
            print(f"   Distance: {result['distance']:.4f}")
        
        # Log to CSV
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        distance = result.get('distance', '')
        
        with open(SCANS_CSV, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                timestamp,
                result.get('roll_no', barcode),
                result['status'],
                distance
            ])
        
        print(f"📝 Logged to {SCANS_CSV}")
        
        # Clean up video file
        try:
            os.remove(video_path)
            print(f"🗑️  Video file removed")
        except Exception as e:
            print(f"⚠️  Could not remove video: {e}")
        
        # Return result
        response_data = {
            'ok': result['ok'],
            'status': result['status'],
            'roll_no': result.get('roll_no', barcode),
            'distance': distance,
            'timestamp': timestamp
        }
        
        print(f"📤 Sending response: {response_data}")
        print("="*50 + "\n")
        
        return jsonify(response_data)
        
    except Exception as e:
        print(f"❌ ERROR in mark_attendance: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/attendance', methods=['GET'])
def get_attendance():
    """
    Return all attendance records from scans.csv
    """
    try:
        records = []
        
        if os.path.exists(SCANS_CSV):
            with open(SCANS_CSV, 'r') as f:
                reader = csv.DictReader(f)
                for row in reader:
                    records.append(row)
                    print(f"📋 Record: {row}")  # Debug log
        
        print(f"✅ Returning {len(records)} records")
        return jsonify({
            'ok': True,
            'records': records,
            'count': len(records)
        })
        
    except Exception as e:
        print(f"❌ Error in get_attendance: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({'error': str(e)}), 500


@app.route('/api/clear_attendance', methods=['POST'])
def clear_attendance():
    """
    Clear all records from scans.csv (keep headers)
    """
    try:
        with open(SCANS_CSV, 'w', newline='') as f:
            writer = csv.writer(f)
            writer.writerow(['timestamp', 'roll_number', 'status', 'distance'])
        
        print("🗑️  Cleared all attendance records")
        return jsonify({
            'ok': True,
            'message': 'All records cleared'
        })
        
    except Exception as e:
        print(f"❌ Error in clear_attendance: {str(e)}")
        return jsonify({'error': str(e)}), 500


@app.route('/api/health', methods=['GET'])
def health_check():
    """Health check endpoint"""
    return jsonify({
        'status': 'healthy',
        'timestamp': datetime.now().isoformat(),
        'upload_folder': UPLOAD_FOLDER,
        'scans_csv_exists': os.path.exists(SCANS_CSV)
    })


@app.route('/api/test', methods=['POST'])
def test_upload():
    """Test endpoint to verify file uploads work"""
    try:
        print("\n📝 TEST UPLOAD REQUEST")
        print(f"Form data: {dict(request.form)}")
        print(f"Files: {list(request.files.keys())}")
        
        if 'video' in request.files:
            video = request.files['video']
            print(f"Video filename: {video.filename}")
            print(f"Video content type: {video.content_type}")
            
        return jsonify({
            'ok': True,
            'form': dict(request.form),
            'files': list(request.files.keys())
        })
    except Exception as e:
        print(f"❌ Test error: {e}")
        return jsonify({'error': str(e)}), 500


if __name__ == '__main__':
    print("\n" + "="*60)
    print("🚀 STARTING FLASK ATTENDANCE SERVER")
    print("="*60)
    print(f"📁 Upload folder: {UPLOAD_FOLDER}")
    print(f"📊 Scans CSV: {SCANS_CSV}")
    print(f"🌐 CORS: Enabled for all origins")
    print(f"📡 Server will run on: http://0.0.0.0:5000")
    print("="*60 + "\n")
    app.run(debug=True, host='0.0.0.0', port=5000)