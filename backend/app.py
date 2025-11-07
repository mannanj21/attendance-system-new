#!/usr/bin/env python3
"""
Flask backend for web-based attendance system
Handles video upload, face verification, and attendance logging
Supports auto-enrollment for new students
"""

from flask import Flask, request, jsonify
from flask_cors import CORS
import os
import csv
import json
import base64
import requests
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


def save_face_data(data):
    # 1️⃣ Save locally
    with open("face_data.json", "w") as f:
        json.dump(data, f, indent=2)

    # 2️⃣ Try to push to GitHub
    token = os.getenv("GITHUB_TOKEN")
    repo = os.getenv("GITHUB_REPO", "mannanj21/attendance-system-new")
    branch = "main"
    file_path = "backend/face_data.json"

    if not token:
        print("⚠️ GITHUB_TOKEN not found, skipping GitHub sync.")
        return

    try:
        # Get current file info (sha) from GitHub
        url = f"https://api.github.com/repos/{repo}/contents/{file_path}"
        headers = {
            "Authorization": f"token {token}",
            "Accept": "application/vnd.github.v3+json"
        }
        get_resp = requests.get(url, headers=headers)
        sha = get_resp.json().get("sha")

        # Prepare content — must be base64 encoded
        content_str = json.dumps(data, indent=2)
        encoded_content = base64.b64encode(content_str.encode("utf-8")).decode("utf-8")

        message = f"Auto-update face_data.json on {datetime.utcnow().isoformat()}"

        payload = {
            "message": message,
            "content": encoded_content,
            "branch": branch,
        }
        if sha:
            payload["sha"] = sha

        put_resp = requests.put(url, headers=headers, json=payload)
        if put_resp.status_code in (200, 201):
            print("✅ face_data.json synced to GitHub.")
        else:
            print(f"⚠️ GitHub sync failed ({put_resp.status_code}):", put_resp.text)

    except Exception as e:
        print("⚠️ Exception during GitHub sync:", e)



@app.route('/api/mark_attendance', methods=['POST'])
def mark_attendance():
    """
    Accept barcode and video file, verify face, log result.
    Auto-enrolls new students on first scan.
    """
    try:
        print("\n" + "=" * 50)
        print("📥 NEW ATTENDANCE REQUEST")
        print("=" * 50)

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

        # Verify face (will auto-enroll if not found)
        print(f"🔍 Starting face verification for {barcode}...")
        result = verify_face(barcode, video_path)

        print(f"✅ Verification complete:")
        print(f"   Status: {result['status']}")
        print(f"   OK: {result['ok']}")
        print(f"   Enrolled: {result.get('enrolled', False)}")
        if 'distance' in result:
            print(f"   Distance: {result.get('distance', 'N/A')}")

        # Prepare status text
        status_text = result['status']
        if result.get('enrolled', False):
            status_text = f"{status_text} (NEW ENROLLMENT)"
            print(f"   🆕 NEW ENROLLMENT - First time for {barcode}")

            try:
                import json
                with open("face_data.json", "r") as f:
                    current_data = json.load(f)
                save_face_data(current_data)
                print("💾 face_data.json saved and synced to GitHub.")
            except Exception as e:
                print("⚠️ Could not sync face_data.json:", e)


        # Log to CSV
        timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        distance = result.get('distance', '')
        
        # Handle distance formatting
        if distance != '' and distance is not None:
            try:
                distance = f"{float(distance):.4f}"
            except (ValueError, TypeError):
                distance = str(distance)

        with open(SCANS_CSV, 'a', newline='') as f:
            writer = csv.writer(f)
            writer.writerow([
                timestamp,
                result.get('roll_no', barcode),
                status_text,
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
            'timestamp': timestamp,
            'enrolled': result.get('enrolled', False)
        }

        print(f"📤 Sending response: {response_data}")
        print("=" * 50 + "\n")

        return jsonify(response_data)

    except Exception as e:
        print(f"❌ ERROR in mark_attendance: {str(e)}")
        import traceback
        traceback.print_exc()
        return jsonify({
            'error': str(e),
            'ok': False,
            'status': 'ERROR'
        }), 500


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
        return jsonify({'error': str(e), 'ok': False}), 500


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
        return jsonify({'error': str(e), 'ok': False}), 500


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
        return jsonify({'error': str(e), 'ok': False}), 500


if __name__ == '__main__':
    print("\n" + "=" * 60)
    print("🚀 STARTING FLASK ATTENDANCE SERVER (AUTO-ENROLLMENT ENABLED)")
    print("=" * 60)
    print(f"📁 Upload folder: {UPLOAD_FOLDER}")
    print(f"📊 Scans CSV: {SCANS_CSV}")
    print(f"🌐 CORS: Enabled for all origins")
    print(f"📡 Server will run on: http://0.0.0.0:5000")
    print(f"🆕 Auto-enrollment: Enabled for new roll numbers")
    print("=" * 60 + "\n")
    app.run(debug=True, host='0.0.0.0', port=5000)