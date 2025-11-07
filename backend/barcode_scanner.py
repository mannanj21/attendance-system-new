#!/usr/bin/env python3
"""
barcode_scanner.py (Refactored for web backend with auto-enrollment)

Provides verify_face() function for face verification from uploaded videos.
If a roll number is not found, it auto-enrolls the student with their face.
"""

import cv2
import re
import json
import os
import numpy as np
import face_recognition

# === Config ===
ROLL_REGEX = re.compile(r'^\d{9}$')
DB_FILE = "face_data.json"
SIMILARITY_THRESHOLD = 0.4
MAX_FRAMES_TO_CHECK = 20
FRAME_SKIP = 2
# ============


def load_face_db():
    """Load face embeddings database"""
    if os.path.exists(DB_FILE):
        try:
            with open(DB_FILE, "r") as f:
                return json.load(f)
        except json.JSONDecodeError:
            print(f"⚠️  Invalid JSON in {DB_FILE}")
            return {}
    print(f"⚠️  {DB_FILE} not found - will create new one")
    return {}


def save_face_db(face_db):
    """Save face embeddings database"""
    try:
        with open(DB_FILE, "w") as f:
            json.dump(face_db, f, indent=2)
        return True
    except Exception as e:
        print(f"❌ Error saving face database: {str(e)}")
        return False


def extract_best_face_from_video(video_path):
    """
    Extract the best quality face encoding from a video.
    Returns (face_encoding, success) tuple.
    """
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        print(f"❌ Cannot open video: {video_path}")
        return None, False
    
    print(f"📹 Extracting face from video: {video_path}")
    
    best_encoding = None
    best_quality = 0  # We'll use face size as quality metric
    frames_checked = 0
    frame_count = 0
    
    while frames_checked < MAX_FRAMES_TO_CHECK:
        ret, frame = cap.read()
        if not ret:
            break
        
        frame_count += 1
        
        # Skip frames for faster processing
        if frame_count % FRAME_SKIP != 0:
            continue
        
        frames_checked += 1
        
        # Convert to RGB
        rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
        
        # Detect faces
        face_locations = face_recognition.face_locations(rgb_frame)
        
        if not face_locations:
            continue
        
        # Extract face encodings
        face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
        
        if not face_encodings:
            continue
        
        # Use the largest face (best quality)
        for i, location in enumerate(face_locations):
            top, right, bottom, left = location
            face_area = (bottom - top) * (right - left)
            
            if face_area > best_quality:
                best_quality = face_area
                best_encoding = face_encodings[i]
                print(f"📊 Frame {frame_count}: Found better face (area: {face_area})")
    
    cap.release()
    
    if best_encoding is not None:
        print(f"✅ Successfully extracted face encoding")
        return best_encoding, True
    else:
        print(f"❌ No face found in video")
        return None, False


def verify_face(barcode: str, video_path: str) -> dict:
    """
    Compares face from video with stored embedding for barcode.
    If barcode not found, auto-enrolls the student with their face.
    
    Args:
        barcode: Student roll number (9 digits)
        video_path: Path to uploaded video file
        
    Returns:
        dict with keys: ok, status, roll_no, distance, enrolled
        status can be: VALID, FACE_MISMATCH, NO_FACE, INVALID_FORMAT, ERROR
        enrolled: True if this was a new enrollment
    """
    
    try:
        # Validate barcode format
        if not ROLL_REGEX.match(barcode):
            print(f"❌ Invalid barcode format: {barcode}")
            return {
                "ok": False,
                "status": "INVALID_FORMAT",
                "roll_no": barcode,
                "enrolled": False
            }
        
        # Check if video exists
        if not os.path.exists(video_path):
            print(f"❌ Video file not found: {video_path}")
            return {
                "ok": False,
                "status": "ERROR",
                "roll_no": barcode,
                "message": "Video file not found",
                "enrolled": False
            }
        
        # Load face database
        face_db = load_face_db()
        
        # Check if student is enrolled
        if barcode not in face_db:
            print(f"⚠️  No enrollment record for {barcode} - AUTO-ENROLLING")
            
            # Extract face from video for enrollment
            face_encoding, success = extract_best_face_from_video(video_path)
            
            if not success or face_encoding is None:
                print(f"❌ Cannot enroll - no face detected in video")
                return {
                    "ok": False,
                    "status": "NO_FACE",
                    "roll_no": barcode,
                    "enrolled": False
                }
            
            # Save the face encoding
            face_db[barcode] = face_encoding.tolist()
            
            if not save_face_db(face_db):
                print(f"❌ Failed to save enrollment")
                return {
                    "ok": False,
                    "status": "ERROR",
                    "roll_no": barcode,
                    "message": "Failed to save enrollment",
                    "enrolled": False
                }
            
            print(f"✅ Successfully enrolled {barcode}")
            print(f"✅ Attendance marked VALID for first-time enrollment")
            
            return {
                "ok": True,
                "status": "VALID",
                "roll_no": barcode,
                "distance": 0.0,
                "enrolled": True
            }
        
        # Student is enrolled - verify face
        print(f"🔍 Verifying face for enrolled student {barcode}")
        
        stored_embedding = np.array(face_db[barcode])
        
        # Extract face from video
        live_encoding, success = extract_best_face_from_video(video_path)
        
        if not success or live_encoding is None:
            print(f"❌ No face detected in video for {barcode}")
            return {
                "ok": False,
                "status": "NO_FACE",
                "roll_no": barcode,
                "enrolled": False
            }
        
        # Compare faces
        distance = face_recognition.face_distance([stored_embedding], live_encoding)[0]
        
        print(f"📊 Face distance: {distance:.3f} (threshold: {SIMILARITY_THRESHOLD})")
        
        # Verify against threshold
        if distance < SIMILARITY_THRESHOLD:
            print(f"✅ Valid attendance for {barcode}")
            return {
                "ok": True,
                "status": "VALID",
                "roll_no": barcode,
                "distance": float(distance),
                "enrolled": False
            }
        else:
            print(f"❌ Face mismatch for {barcode}")
            return {
                "ok": False,
                "status": "FACE_MISMATCH",
                "roll_no": barcode,
                "distance": float(distance),
                "enrolled": False
            }
            
    except Exception as e:
        print(f"❌ Error in verify_face: {str(e)}")
        import traceback
        traceback.print_exc()
        return {
            "ok": False,
            "status": "ERROR",
            "roll_no": barcode,
            "message": str(e),
            "enrolled": False
        }


# Test function
if __name__ == "__main__":
    print("Testing verify_face function with auto-enrollment...")
    
    # Example usage
    test_barcode = "123456789"
    test_video = "test_video.webm"
    
    if os.path.exists(test_video):
        result = verify_face(test_barcode, test_video)
        print(f"\nResult: {result}")
    else:
        print(f"Test video not found: {test_video}")
        print("\nFunction is ready to use with:")
        print("  result = verify_face('123456789', '/path/to/video.webm')")