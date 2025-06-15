import { useEffect, useRef, useState } from 'react';
import { io } from 'socket.io-client';

const BACKEND_URL = import.meta.env.VITE_BACKEND_URL || 'http://localhost:3000';

const LocalVideoOnly = () => {
  const videoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const peerConnectionRef = useRef(null);
  const socketRef = useRef(null);
  const localStreamRef = useRef(null);
  const [error, setError] = useState(null);
  const [status, setStatus] = useState('Waiting for camera...');
  const [role, setRole] = useState(null); // 'offerer' or 'answerer'
  const roleRef = useRef(null); // Use ref for role
  const pendingCandidatesRef = useRef([]);
  const pendingOfferRef = useRef(null); // Store pending offer if needed

  useEffect(() => {
    // Get local media
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.log('Video play error:', e));
        }
        localStreamRef.current = stream;
        setStatus('Connecting to server...');
        startSignaling();
      })
      .catch((err) => {
        setError('Error accessing camera and microphone: ' + err.message);
      });
    // Cleanup
    return () => {
      if (socketRef.current) socketRef.current.disconnect();
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (localStreamRef.current) localStreamRef.current.getTracks().forEach(track => track.stop());
      if (videoRef.current) videoRef.current.srcObject = null;
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    };
    // eslint-disable-next-line
  }, []);

  function startSignaling() {
    socketRef.current = io(BACKEND_URL);
    socketRef.current.on('connect', () => {
      setStatus('Connected to server, waiting for partner...');
      console.log('[Socket] Connected to server');
      console.log('[Socket] My socket ID:', socketRef.current.id);
      socketRef.current.emit('join');
    });
    socketRef.current.onAny((event, ...args) => {
      console.log('[Socket Event]', event, args);
    });
    socketRef.current.on('partner-found', ({ partnerId, role }) => {
      setStatus('Partner found! Connecting...');
      setRole(role);
      roleRef.current = role; // Update ref
      console.log('[Socket] Partner found:', partnerId, 'Role:', role);
      createPeerConnection(partnerId, role);
      // If we received an offer before peer connection was ready, process it now
      if (role === 'answerer' && pendingOfferRef.current) {
        console.log('[Socket] Processing pending offer after peer connection created:', pendingOfferRef.current);
        handleOffer(pendingOfferRef.current);
        pendingOfferRef.current = null;
      }
    });
    socketRef.current.on('offer', (data) => {
      console.log('[Socket] Offer event received:', data);
      // If peer connection is not ready, store the offer
      if (!peerConnectionRef.current) {
        console.log('[Socket] Offer received before peer connection ready, queueing');
        pendingOfferRef.current = data;
        return;
      }
      handleOffer(data);
    });
    socketRef.current.on('answer', handleAnswer);
    socketRef.current.on('ice-candidate', handleIceCandidate);
    socketRef.current.on('partner-left', () => {
      setStatus('Partner left. Refresh to try again.');
      console.log('[Socket] Partner left');
      if (peerConnectionRef.current) peerConnectionRef.current.close();
      if (remoteVideoRef.current) remoteVideoRef.current.srcObject = null;
    });
  }

  function createPeerConnection(partnerId, role) {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        {
          urls: 'turn:openrelay.metered.ca:80',
          username: 'openrelayproject',
          credential: 'openrelayproject'
        }
      ]
    });
    peerConnectionRef.current = pc;
    console.log('[WebRTC] Created RTCPeerConnection', pc);
    // Add local tracks
    if (localStreamRef.current) {
      localStreamRef.current.getTracks().forEach(track => {
        pc.addTrack(track, localStreamRef.current);
        console.log('[WebRTC] Added local track:', track.kind);
      });
    }
    // ICE
    pc.onicecandidate = (event) => {
      if (event.candidate) {
        console.log('[WebRTC] ICE candidate:', event.candidate);
        socketRef.current.emit('ice-candidate', {
          target: partnerId,
          candidate: event.candidate
        });
      }
    };
    pc.oniceconnectionstatechange = () => {
      console.log('[WebRTC] ICE connection state:', pc.iceConnectionState);
      setStatus('ICE connection state: ' + pc.iceConnectionState);
    };
    pc.onconnectionstatechange = () => {
      console.log('[WebRTC] Connection state:', pc.connectionState);
      setStatus('Connection state: ' + pc.connectionState);
    };
    // Remote stream
    pc.ontrack = (event) => {
      console.log('[WebRTC] ontrack event:', event.streams);
      if (remoteVideoRef.current && event.streams[0]) {
        const stream = event.streams[0];
        const videoTracks = stream.getVideoTracks();
        const audioTracks = stream.getAudioTracks();
        console.log('[WebRTC] Remote stream video tracks:', videoTracks);
        console.log('[WebRTC] Remote stream audio tracks:', audioTracks);
        videoTracks.forEach(track => {
          console.log('[WebRTC] Remote video track enabled:', track.enabled, 'readyState:', track.readyState);
        });
        // Only set srcObject if it's not already set to this stream
        if (remoteVideoRef.current.srcObject !== stream) {
          remoteVideoRef.current.srcObject = stream;
          console.log('[WebRTC] Set remote video srcObject:', stream);
          remoteVideoRef.current.play()
            .then(() => console.log('[WebRTC] Remote video playing'))
            .catch(e => console.log('[WebRTC] Remote video play error:', e));
        } else {
          console.log('[WebRTC] Remote video srcObject already set, skipping');
        }
        remoteVideoRef.current.style.border = '3px solid red';
        remoteVideoRef.current.style.background = '#222';
        setTimeout(() => {
          const rect = remoteVideoRef.current.getBoundingClientRect();
          console.log('[WebRTC] Remote video element size:', rect.width, rect.height, 'display:', getComputedStyle(remoteVideoRef.current).display, 'visibility:', getComputedStyle(remoteVideoRef.current).visibility);
        }, 500);
      } else {
        console.log('[WebRTC] ontrack: No remote video element or no stream');
      }
    };
    // Only the offerer creates offer
    if (role === 'offerer') {
      pc.createOffer()
        .then(offer => {
          console.log('[WebRTC] Created offer:', offer);
          return pc.setLocalDescription(offer);
        })
        .then(() => {
          console.log('[WebRTC] Set local description (offer)');
          socketRef.current.emit('offer', {
            target: partnerId,
            sdp: pc.localDescription
          });
        });
    }
  }

  async function handleOffer(data) {
    console.log('[Socket] Received offer event', data);
    if (!peerConnectionRef.current) {
      console.log('[WebRTC] Peer connection not ready, queueing offer');
      pendingOfferRef.current = data;
      return;
    }
    if (roleRef.current !== 'answerer') {
      console.log('[WebRTC] Not answerer, skipping offer handling. Current role:', roleRef.current);
      return; // Only answerer handles offer
    }
    console.log('[WebRTC] Received offer:', data.sdp);
    console.log('[WebRTC] Signaling state before setRemoteDescription:', peerConnectionRef.current.signalingState);
    // Process the offer even if the signaling state is 'stable'
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    console.log('[WebRTC] Set remote description (offer)');
    // Add any queued ICE candidates
    if (pendingCandidatesRef.current.length > 0) {
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
          console.log('[WebRTC] Added queued ICE candidate');
        } catch (e) {
          console.error('Error adding queued ICE candidate', e);
        }
      }
      pendingCandidatesRef.current = [];
    }
    const answer = await peerConnectionRef.current.createAnswer();
    console.log('[WebRTC] Created answer:', answer);
    await peerConnectionRef.current.setLocalDescription(answer);
    console.log('[WebRTC] Set local description (answer)');
    socketRef.current.emit('answer', {
      target: data.target,
      sdp: peerConnectionRef.current.localDescription
    });
  }

  async function handleAnswer(data) {
    if (!peerConnectionRef.current) return;
    if (roleRef.current !== 'offerer') {
      console.log('[WebRTC] Not offerer, skipping answer handling. Current role:', roleRef.current);
      return; // Only offerer handles answer
    }
    console.log('[WebRTC] Received answer:', data.sdp);
    console.log('[WebRTC] Signaling state before setRemoteDescription:', peerConnectionRef.current.signalingState);
    await peerConnectionRef.current.setRemoteDescription(new RTCSessionDescription(data.sdp));
    console.log('[WebRTC] Set remote description (answer)');
    // Add any queued ICE candidates
    if (pendingCandidatesRef.current.length > 0) {
      for (const candidate of pendingCandidatesRef.current) {
        try {
          await peerConnectionRef.current.addIceCandidate(candidate);
          console.log('[WebRTC] Added queued ICE candidate');
        } catch (e) {
          console.error('Error adding queued ICE candidate', e);
        }
      }
      pendingCandidatesRef.current = [];
    }
  }

  async function handleIceCandidate(data) {
    try {
      if (!peerConnectionRef.current) return;
      console.log('[WebRTC] Received ICE candidate:', data.candidate);
      const candidate = new RTCIceCandidate(data.candidate);
      console.log('[WebRTC] Signaling state before addIceCandidate:', peerConnectionRef.current.signalingState);
      if (
        peerConnectionRef.current.remoteDescription &&
        peerConnectionRef.current.remoteDescription.type
      ) {
        await peerConnectionRef.current.addIceCandidate(candidate);
        console.log('[WebRTC] Added ICE candidate');
      } else {
        pendingCandidatesRef.current.push(candidate);
        console.log('[WebRTC] Queued ICE candidate');
      }
    } catch (e) {
      console.error('Error adding received ice candidate', e);
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', justifyContent: 'center', background: '#222' }}>
      <div style={{ color: 'white', fontSize: 20, margin: '24px 0 12px 0' }}>{status}</div>
      {error && <div style={{ color: 'red', marginBottom: 12 }}>{error}</div>}
      <div className="video-container-responsive">
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', marginBottom: 16 }}>
          <video ref={videoRef} autoPlay playsInline muted width={320} height={240} style={{ background: '#111', borderRadius: 8, border: '2px solid #444', width: '90vw', maxWidth: 400, height: 'auto' }} />
          <div style={{ color: '#bbb', marginTop: 6 }}>You</div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
          <video ref={remoteVideoRef} autoPlay playsInline width={320} height={240} style={{ background: '#111', borderRadius: 8, border: '2px solid #444', width: '90vw', maxWidth: 400, height: 'auto' }} />
          <div style={{ color: '#bbb', marginTop: 6 }}>Partner</div>
        </div>
      </div>
      <style>{`
        .video-container-responsive {
          display: flex;
          flex-direction: row;
          gap: 24px;
          align-items: center;
          justify-content: center;
        }
        @media (max-width: 700px) {
          .video-container-responsive {
            flex-direction: column;
            gap: 0;
          }
        }
      `}</style>
    </div>
  );
};

export default LocalVideoOnly; 