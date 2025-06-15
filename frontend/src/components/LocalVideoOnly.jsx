import { useEffect, useRef, useState } from 'react';

const LocalVideoOnly = () => {
  const videoRef = useRef(null);
  const remoteVideoRef = useRef(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    navigator.mediaDevices.getUserMedia({ video: true, audio: true })
      .then((stream) => {
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.play().catch(e => console.log('Video play error:', e));
        }
      })
      .catch((err) => {
        setError('Error accessing camera and microphone: ' + err.message);
      });
  }, []);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minHeight: '100vh', justifyContent: 'center', background: '#222' }}>
      <h2 style={{ color: 'white' }}>Local & Remote Video (Layout Test)</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <div style={{ display: 'flex', flexDirection: 'row', gap: 32 }}>
        <div>
          <div style={{ color: 'white', marginBottom: 4 }}>You</div>
          <video ref={videoRef} autoPlay playsInline muted width={400} height={300} style={{ background: '#000' }} />
        </div>
        <div>
          <div style={{ color: 'white', marginBottom: 4 }}>Partner</div>
          <video ref={remoteVideoRef} autoPlay playsInline width={400} height={300} style={{ background: '#000' }} />
        </div>
      </div>
    </div>
  );
};

export default LocalVideoOnly; 