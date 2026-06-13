import { useEffect } from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import MapPage from './pages/Map';
import Register from './pages/Register';
import RegisterSuccess from './pages/RegisterSuccess';
import Login from './pages/Login';
import Place from './pages/Place';
import PlaceSuccess from './pages/PlaceSuccess';
import Inbox from './pages/Inbox';
import Account from './pages/Account';
import Privacy from './pages/Privacy';
import CookieBanner from './components/CookieBanner';

export default function App() {
  // Initialise the CSS theme from the user's saved map-theme preference.
  useEffect(() => {
    const saved = localStorage.getItem('pd_map_theme');
    document.documentElement.dataset.theme = saved === 'light' ? 'light' : 'dark';
  }, []);

  return (
    <>
    <Routes>
      <Route path="/" element={<MapPage />} />
      <Route path="/register" element={<Register />} />
      <Route path="/register/success" element={<RegisterSuccess />} />
      <Route path="/login" element={<Login />} />
      <Route path="/place" element={<Place />} />
      <Route path="/place/success" element={<PlaceSuccess />} />
      <Route path="/inbox" element={<Inbox />} />
      <Route path="/account" element={<Account />} />
      <Route path="/privacy" element={<Privacy />} />
      {/* Redirect old routes */}
      <Route path="/map" element={<Navigate to="/" replace />} />
      <Route path="/subscribe" element={<Navigate to="/" replace />} />
    </Routes>
    <CookieBanner />
    </>
  );
}
