import axios from 'axios';

const api = axios.create({
  baseURL: import.meta.env.VITE_BACKEND_URL,
  withCredentials: true, // send httpOnly cookies
});

export default api;

// ─── Types ────────────────────────────────────────────────────────────────────

export type Lang = 'en' | 'es' | 'pt';

export interface Pixel {
  id: number;
  lat: number;
  lng: number;
  type: 'person' | 'event';
  color: string;
  is_dimmed: boolean;
  gender?: string;
  user_id?: string;
  country_code?: string;
  event_text?: string | null;
  event_date?: string | null;
  is_compatible?: boolean;
}

export interface HeatmapPixel {
  lat: number;
  lng: number;
  type: 'person' | 'event';
  country_code: string;
}

export type PersonPixelPreview = {
  type: 'person';
  first_name: string;
  age: number;
  country: string;
  country_code: string;
  expires_in_days: number;
  is_compatible: boolean;
};

export type EventPixelPreview = {
  type: 'event';
  event_text: string;
  event_description: string | null;
  event_date: string;
  expires_in_days: number;
  expires_at: string;
  country: string;
  country_code: string;
  participants_count: number;
  is_participant: boolean;
};

export type PixelPreview = PersonPixelPreview | EventPixelPreview;

export interface CountryOccupancy {
  country_code: string;
  name: string;
  area_km2: number;
  person_count: number;
  event_count: number;
  total_count: number;
  occupancy_pct: number;
  density_ceiling_per_km2: number;
}

export interface CountryListItem {
  code: string;
  name: string;
  area_km2: number;
}

export interface MyPixel {
  id: number;
  lat: number;
  lng: number;
  type: 'person' | 'event';
  expires_at: string;
  is_active?: boolean;
  color?: string;
  event_text?: string | null;
  event_date?: string | null;
}

export interface UserMe {
  id: string;
  name: string;
  birth_year: number;
  gender: string;
  interested_in: string[];
  country_code: string;
  lang: Lang;
  pixel: { id: number; lat: number; lng: number; type: string; expires_at: string } | null;
  likes_remaining: number;
  likes_reset_at: string | null;
  likes_pending: number;
  daily_like_limit: number;
}

export interface PendingConnection {
  id: string;
  created_at: string;
  expires_at: string;
  from_name: string;
  from_age: number;
}

export interface MatchedConnection {
  id: string;
  matched_at: string;
  match_name: string;
  match_age: number;
  match_email: string;
}

export interface SentConnection {
  id: string;
  status: string;
  created_at: string;
  expires_at: string;
  to_name: string;
  to_age: number;
}

export interface PlacePixelBody {
  lat: number;
  lng: number;
  type: 'person' | 'event';
  country_code: string;
  event_text?: string;
  event_description?: string;
  event_date?: string; // ISO YYYY-MM-DD, required for type='event'
}

export const participateInEvent = (pixelId: number) =>
  api.post<{ participants_count: number; is_participant: true }>(`/api/event/${pixelId}/participate`).then(r => r.data);

export const leaveEvent = (pixelId: number) =>
  api.delete<{ participants_count: number; is_participant: false }>(`/api/event/${pixelId}/participate`).then(r => r.data);

// ─── API Calls ────────────────────────────────────────────────────────────────

export const getMe = () =>
  api.get<UserMe>('/api/user/me').then(r => r.data);

export const getMyPixel = () =>
  api.get<MyPixel | null>('/api/user/my-pixel').then(r => r.data);

export const getMyPixels = () =>
  api.get<{ pixels: MyPixel[] }>('/api/pixel/mine').then(r => r.data);

export const cancelPixel = (pixelId: number) =>
  api.delete(`/api/pixel/${pixelId}`).then(r => r.data);

export const getConnections = () =>
  api.get<{
    pending: PendingConnection[];
    matched: MatchedConnection[];
    sent: SentConnection[];
  }>('/api/user/connections').then(r => r.data);

export const getHeatmap = () =>
  api.get<{ pixels: HeatmapPixel[] }>('/api/map/heatmap').then(r => r.data);

export interface PixelsQuery {
  minLat?: number;
  maxLat?: number;
  minLng?: number;
  maxLng?: number;
  compat?: boolean;
}

export const getAllPixels = (q: PixelsQuery = {}) =>
  api.get<{ pixels: Pixel[] }>('/api/map/pixels', {
    params: {
      ...(q.minLat != null && { minLat: q.minLat, maxLat: q.maxLat, minLng: q.minLng, maxLng: q.maxLng }),
      ...(q.compat && { compat: 1 }),
    },
  }).then(r => r.data);

export const getPixelPreview = (pixelId: number, lang: Lang) =>
  api.get<PixelPreview>(`/api/pixel/${pixelId}/preview`, { params: { lang } }).then(r => r.data);

export interface PixelStatus {
  is_active: boolean;
  payment_status: 'pending' | 'completed' | 'failed' | null;
  expires_at: string;
}

export const getPixelStatus = (pixelId: number) =>
  api.get<PixelStatus>(`/api/pixel/${pixelId}/status`).then(r => r.data);

export const getCountryOccupancy = (cc: string, lang: Lang) =>
  api.get<CountryOccupancy>(`/api/cities/country/${cc}/occupancy`, { params: { lang } }).then(r => r.data);

export const listCountries = (lang: Lang) =>
  api.get<{ countries: CountryListItem[] }>('/api/cities/countries', { params: { lang } }).then(r => r.data);

export const validatePixelLocation = (lat: number, lng: number, type: 'person' | 'event', country_code: string) =>
  api.post<{ valid: boolean; reason?: string }>('/api/pixel/validate', { lat, lng, type, country_code }).then(r => r.data);

export const placePixel = (body: PlacePixelBody) =>
  api.post<{ stripe_checkout_url: string }>('/api/pixel/place', body).then(r => r.data);

export const sendLike = (pixelId: number) =>
  api.post<{ likes_remaining: number; likes_reset_at: string | null }>(`/api/like/${pixelId}`).then(r => r.data);

export const respondToConnection = (connectionId: string, accept: boolean) =>
  api.post(`/api/connection/${connectionId}/respond`, { accept }).then(r => r.data);

export interface UpdatePrefsBody {
  interested_in?: string[];
  lang?: Lang;
}

export const updatePreferences = (body: UpdatePrefsBody) =>
  api.put('/api/user/me', body).then(r => r.data);

export const deleteAccount = () =>
  api.delete('/api/user/me').then(r => r.data);

export const logout = () =>
  api.post('/api/auth/logout').then(r => r.data);

export const login = (email: string, password: string) =>
  api.post<{ ok: boolean }>('/api/auth/login', { email, password }).then(r => r.data);
