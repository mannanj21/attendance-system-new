#!/usr/bin/env python3
"""
barcode_scanner.py (Refactored for web backend)

Provides verify_face() function for face verification from uploaded videos.
No camera UI - just face comparison logic.
Optimized for faster processing.
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
MAX_FRAMES_TO_CHECK = 20  # Reduced from 30 for faster processing
FRAME_SKIP = 2  # Process every 2nd frame for speed
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
    print(f"⚠️  {DB_FILE} not found")
    return {}


def verify_face(barcode: str, video_path: str) -> dict:
    """
    Compares face from video with stored embedding for barcode.
    
    Args:
        barcode: Student roll number (9 digits)
        video_path: Path to uploaded video file
        
    Returns:
        dict with keys: ok, status, roll_no, distance
        status can be: VALID, FACE_MISMATCH, NO_RECORD, NO_FACE, INVALID_FORMAT, ERROR
    """
    
    try:
        # Validate barcode format
        if not ROLL_REGEX.match(barcode):
            print(f"❌ Invalid barcode format: {barcode}")
            return {
                "ok": False,
                "status": "INVALID_FORMAT",
                "roll_no": barcode
            }
        
        # Load face database
        face_db = load_face_db()
        
        # Check if student is enrolled
        if barcode not in face_db:
            print(f"❌ No enrollment record for {barcode}")
            return {
                "ok": False,
                "status": "NO_RECORD",
                "roll_no": barcode
            }
        
        # Load stored face embedding
        stored_embedding = np.array(face_db[barcode])
        
        # Open video file
        if not os.path.exists(video_path):
            print(f"❌ Video file not found: {video_path}")
            return {
                "ok": False,
                "status": "ERROR",
                "roll_no": barcode,
                "message": "Video file not found"
            }
        
        cap = cv2.VideoCapture(video_path)
        if not cap.isOpened():
            print(f"❌ Cannot open video: {video_path}")
            return {
                "ok": False,
                "status": "ERROR",
                "roll_no": barcode,
                "message": "Cannot open video file"
            }
        
        print(f"📹 Processing video: {video_path}")
        
        # Extract faces from video frames (optimized)
        face_found = False
        best_distance = float('inf')
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
            
            # Convert to RGB for face_recognition
            rgb_frame = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
            
            # Detect faces
            face_locations = face_recognition.face_locations(rgb_frame)
            
            if not face_locations:
                continue
            
            # Extract face encodings
            face_encodings = face_recognition.face_encodings(rgb_frame, face_locations)
            
            if not face_encodings:
                continue
            
            face_found = True
            
            # Compare with stored embedding
            for live_embedding in face_encodings:
                dist = face_recognition.face_distance([stored_embedding], live_embedding)[0]
                
                if dist < best_distance:
                    best_distance = dist
                
                print(f"📊 Frame {frame_count}: Face distance = {dist:.3f}")
        
        cap.release()
        
        # Check results
        if not face_found:
            print(f"❌ No face detected in video for {barcode}")
            return {
                "ok": False,
                "status": "NO_FACE",
                "roll_no": barcode
            }
        
        print(f"📊 Best face distance: {best_distance:.3f} (threshold: {SIMILARITY_THRESHOLD})")
        
        # Verify against threshold
        if best_distance < SIMILARITY_THRESHOLD:
            print(f"✅ Valid attendance for {barcode}")
            return {
                "ok": True,
                "status": "VALID",
                "roll_no": barcode,
                "distance": float(best_distance)
            }
        else:
            print(f"❌ Face mismatch for {barcode}")
            return {
                "ok": False,
                "status": "FACE_MISMATCH",
                "roll_no": barcode,
                "distance": float(best_distance)
            }
            
    except Exception as e:
        print(f"❌ Error in verify_face: {str(e)}")
        return {
            "ok": False,
            "status": "ERROR",
            "roll_no": barcode,
            "message": str(e)
        }


# Test function
if __name__ == "__main__":
    print("Testing verify_face function...")
    
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