import { useEffect, useRef, useState } from 'react';

const LocalVideoTest = () => {
  const videoRef = useRef(null);
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
    <div>
      <h2>Local Video Test</h2>
      {error && <div style={{ color: 'red' }}>{error}</div>}
      <video ref={videoRef} autoPlay playsInline muted width={400} height={300} />
    </div>
  );
};

export default LocalVideoTest; 