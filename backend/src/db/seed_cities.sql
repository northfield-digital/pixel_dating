-- Seed cities for MVP: Spain (ES), Switzerland (CH), Argentina (AR), Mexico (MX)
-- soft_capacity based on population tiers:
--   > 3M       → 10,000
--   1M–3M      → 6,000
--   300K–1M    → 3,000
--   100K–300K  → 1,500
-- boundary: NULL initially — add GeoJSON polygons incrementally per city

INSERT INTO cities (name, country_code, lat, lng, soft_capacity) VALUES

-- Spain (ES)
('Madrid',    'ES', 40.4168, -3.7038,  10000),
('Barcelona', 'ES', 41.3851, 2.1734,   10000),
('Valencia',  'ES', 39.4699, -0.3763,  6000),
('Seville',   'ES', 37.3891, -5.9845,  6000),
('Zaragoza',  'ES', 41.6488, -0.8891,  3000),
('Málaga',    'ES', 36.7213, -4.4214,  3000),
('Murcia',    'ES', 37.9922, -1.1307,  3000),
('Palma',     'ES', 39.5696, 2.6502,   3000),
('Las Palmas','ES', 28.1235, -15.4366, 3000),
('Bilbao',    'ES', 43.2630, -2.9350,  1500),
('Alicante',  'ES', 38.3452, -0.4815,  1500),
('Córdoba',   'ES', 37.8882, -4.7794,  1500),
('Valladolid','ES', 41.6523, -4.7245,  1500),
('Vigo',      'ES', 42.2328, -8.7226,  1500),
('Gijón',     'ES', 43.5453, -5.6615,  1500),

-- Switzerland (CH)
('Zürich',    'CH', 47.3769, 8.5417,   6000),
('Geneva',    'CH', 46.2044, 6.1432,   3000),
('Basel',     'CH', 47.5596, 7.5886,   3000),
('Bern',      'CH', 46.9480, 7.4474,   3000),
('Lausanne',  'CH', 46.5197, 6.6323,   3000),
('Winterthur','CH', 47.5001, 8.7238,   1500),
('Lucerne',   'CH', 47.0502, 8.3093,   1500),
('St. Gallen','CH', 47.4245, 9.3767,   1500),
('Lugano',    'CH', 46.0037, 8.9511,   1500),
('Biel',      'CH', 47.1368, 7.2467,   1500),

-- Argentina (AR)
('Buenos Aires',  'AR', -34.6037, -58.3816, 10000),
('Córdoba',       'AR', -31.4201, -64.1888, 6000),
('Rosario',       'AR', -32.9442, -60.6505, 6000),
('Mendoza',       'AR', -32.8908, -68.8272, 3000),
('Tucumán',       'AR', -26.8083, -65.2176, 3000),
('La Plata',      'AR', -34.9214, -57.9545, 3000),
('Mar del Plata', 'AR', -38.0055, -57.5426, 3000),
('Salta',         'AR', -24.7821, -65.4232, 1500),
('Santa Fe',      'AR', -31.6333, -60.7000, 1500),
('San Juan',      'AR', -31.5375, -68.5364, 1500),
('Resistencia',   'AR', -27.4514, -58.9867, 1500),
('Neuquén',       'AR', -38.9516, -68.0591, 1500),

-- Mexico (MX)
('Ciudad de México', 'MX', 19.4326, -99.1332,  10000),
('Guadalajara',      'MX', 20.6597, -103.3496, 6000),
('Monterrey',        'MX', 25.6866, -100.3161, 6000),
('Puebla',           'MX', 19.0414, -98.2063,  3000),
('Tijuana',          'MX', 32.5149, -117.0382, 3000),
('León',             'MX', 21.1221, -101.6824, 3000),
('Juárez',           'MX', 31.6904, -106.4245, 3000),
('Torreón',          'MX', 25.5428, -103.4068, 3000),
('San Luis Potosí',  'MX', 22.1565, -100.9855, 3000),
('Mérida',           'MX', 20.9674, -89.5926,  3000),
('Mexicali',         'MX', 32.6245, -115.4523, 1500),
('Culiacán',         'MX', 24.8091, -107.3940, 1500),
('Acapulco',         'MX', 16.8531, -99.8237,  1500),
('Hermosillo',       'MX', 29.0730, -110.9559, 1500),
('Saltillo',         'MX', 25.4232, -100.9936, 1500)

ON CONFLICT DO NOTHING;
