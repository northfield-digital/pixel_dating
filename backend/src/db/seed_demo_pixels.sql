-- Seed 2300 demo pixels across ES / CH / AR / MX.
-- Run this in the Supabase SQL editor (no network connection needed).
--
-- BEFORE RUNNING: replace the two placeholder values below with your actual
-- secrets from backend/.env
--   enc_key  → EMAIL_ENCRYPTION_KEY
--   hash_key → EMAIL_HASH_KEY
--
-- To remove these bots later: UPDATE users SET deleted_at = now()
--   WHERE pgp_sym_decrypt(email, '<enc_key>') LIKE '%@dev.pixeldating.test';

DO $$
DECLARE
  enc_key  TEXT := 'REPLACE_WITH_EMAIL_ENCRYPTION_KEY';
  hash_key TEXT := 'REPLACE_WITH_EMAIL_HASH_KEY';

  male_names TEXT[] := ARRAY[
    'Alejandro','Diego','Mateo','Santiago','Sebastián','Nicolás','Andrés','Gabriel',
    'Julián','Carlos','Roberto','Javier','Miguel','Pablo','Jorge','Alberto','Fernando',
    'Rafael','Hugo','Marcos','Rodrigo','Emilio','Manuel','Luis','Ramón','Felipe',
    'Ignacio','Tomás','Arturo','Eduardo','Adrián','Héctor','Víctor','Gustavo','Mauricio',
    'Raúl','Sergio','Óscar','Daniel','José','Antonio','Mario','Pedro','Ricardo',
    'Enrique','Bruno','César','Darío','Esteban','Gonzalo','Leandro','Lucas','Marcelo',
    'Martín','Octavio','Patricio','Renato','Ramiro','Salvador','Valentín','Iván',
    'Stefan','Michael','Andreas','Thomas','Markus','Christian','Philipp','Simon',
    'Lukas','Florian','Tobias','Patrick','Felix','Jonas','Benjamin','Samuel',
    'Aaron','Noah','Leon','Marc','Jan','Elias','Alexander','Antoine','Baptiste',
    'François','Guillaume','Henri','Maxime','Pierre','Vincent','Xavier'
  ];

  female_names TEXT[] := ARRAY[
    'Sofía','Valentina','Camila','Lucía','Isabella','Emma','Martina','Valeria',
    'Daniela','Paula','María','Laura','Ana','Sara','Elena','Carmen','Rosa','Clara',
    'Nora','Julia','Claudia','Adriana','Alicia','Andrea','Ángela','Beatriz','Carla',
    'Catalina','Cecilia','Diana','Estela','Fernanda','Gabriela','Gloria','Helena',
    'Inés','Irene','Jimena','Josefina','Leticia','Lorena','Magdalena','Manuela',
    'Mercedes','Mónica','Natalia','Patricia','Pilar','Raquel','Rebeca',
    'Renata','Rocío','Sonia','Susana','Teresa','Verónica','Viviana','Ximena',
    'Yolanda','Ariana','Carolina','Isabel','Lola','Miriam','Sandra','Mariana',
    'Alejandra','Brenda','Karina','Paola','Florencia','Agustina','Micaela','Romina',
    'Anna','Sarah','Lisa','Lena','Nicole','Katharina','Sabine','Franziska',
    'Monika','Angela','Caroline','Elisabeth','Eva','Heidi','Nina',
    'Petra','Sophie','Camille','Charlotte','Juliette','Mathilde','Pauline'
  ];

  nb_names TEXT[] := ARRAY[
    'Alex','Jordan','Sam','Morgan','Taylor','Riley','Casey','Quinn','Dakota','Avery',
    'Skyler','Robin','Jesse','Charlie','Blair','Emery','Finley','Hayden','Jamie','Kai',
    'Lane','Marley','Parker','Remy','Rowan','Scout','Spencer','Sydney','Elliot','River'
  ];

  i_opts TEXT[] := ARRAY[
    'female', 'male', 'female|non-binary', 'male|non-binary', 'male|female', 'male|female|non-binary'
  ];

  es_ids  INT[];  es_lats NUMERIC[];  es_lngs NUMERIC[];
  ch_ids  INT[];  ch_lats NUMERIC[];  ch_lngs NUMERIC[];
  ar_ids  INT[];  ar_lats NUMERIC[];  ar_lngs NUMERIC[];
  mx_ids  INT[];  mx_lats NUMERIC[];  mx_lngs NUMERIC[];
  es_n INT; ch_n INT; ar_n INT; mx_n INT;

  i         INT;
  cc_slot   INT;
  g_slot    INT;
  v_cc      TEXT;
  v_gender  TEXT;
  v_color   TEXT;
  v_name    TEXT;
  v_email   TEXT;
  v_hash    BYTEA;
  v_uid     UUID;
  v_city_id INT;
  v_clat    NUMERIC;
  v_clng    NUMERIC;
  v_lat     NUMERIC;
  v_lng     NUMERIC;
  v_birth   INT;
  v_ints    TEXT[];
  n         INT;
BEGIN
  SELECT array_agg(id ORDER BY soft_capacity DESC),
         array_agg(lat::NUMERIC ORDER BY soft_capacity DESC),
         array_agg(lng::NUMERIC ORDER BY soft_capacity DESC)
  INTO es_ids, es_lats, es_lngs FROM cities WHERE country_code = 'ES';

  SELECT array_agg(id ORDER BY soft_capacity DESC),
         array_agg(lat::NUMERIC ORDER BY soft_capacity DESC),
         array_agg(lng::NUMERIC ORDER BY soft_capacity DESC)
  INTO ch_ids, ch_lats, ch_lngs FROM cities WHERE country_code = 'CH';

  SELECT array_agg(id ORDER BY soft_capacity DESC),
         array_agg(lat::NUMERIC ORDER BY soft_capacity DESC),
         array_agg(lng::NUMERIC ORDER BY soft_capacity DESC)
  INTO ar_ids, ar_lats, ar_lngs FROM cities WHERE country_code = 'AR';

  SELECT array_agg(id ORDER BY soft_capacity DESC),
         array_agg(lat::NUMERIC ORDER BY soft_capacity DESC),
         array_agg(lng::NUMERIC ORDER BY soft_capacity DESC)
  INTO mx_ids, mx_lats, mx_lngs FROM cities WHERE country_code = 'MX';

  es_n := array_length(es_ids, 1);
  ch_n := array_length(ch_ids, 1);
  ar_n := array_length(ar_ids, 1);
  mx_n := array_length(mx_ids, 1);

  FOR i IN 0..2299 LOOP
    -- Country distribution: 0-5 ES (30%), 6-7 CH (10%), 8-13 AR (30%), 14-19 MX (25%) + top-up
    cc_slot := i % 20;
    IF    cc_slot <= 5  THEN v_cc := 'ES';
    ELSIF cc_slot <= 7  THEN v_cc := 'CH';
    ELSIF cc_slot <= 13 THEN v_cc := 'AR';
    ELSE                     v_cc := 'MX';
    END IF;

    -- Gender (round-robin): male×2, female×2, non-binary, other
    g_slot := i % 6;
    IF    g_slot <= 1 THEN v_gender := 'male';       v_color := '#6B9FD4';
    ELSIF g_slot <= 3 THEN v_gender := 'female';     v_color := '#E06878';
    ELSIF g_slot =  4 THEN v_gender := 'non-binary'; v_color := '#B07FC8';
    ELSE                   v_gender := 'other';      v_color := '#B07FC8';
    END IF;

    -- Name matched to gender
    IF v_gender = 'male' THEN
      v_name := male_names[(i % array_length(male_names, 1)) + 1];
    ELSIF v_gender = 'female' THEN
      v_name := female_names[(i % array_length(female_names, 1)) + 1];
    ELSE
      v_name := nb_names[(i % array_length(nb_names, 1)) + 1];
    END IF;

    v_email := 'demo_' || v_cc || '_' || i || '@dev.pixeldating.test';
    v_hash  := hmac(lower(trim(v_email))::bytea, hash_key::bytea, 'sha256');
    v_birth := 1985 + (i % 18);
    v_ints  := string_to_array(i_opts[(i % array_length(i_opts, 1)) + 1], '|');

    -- City (round-robin, biggest cities first)
    IF v_cc = 'ES' THEN
      n := (i % es_n) + 1;
      v_city_id := es_ids[n]; v_clat := es_lats[n]; v_clng := es_lngs[n];
    ELSIF v_cc = 'CH' THEN
      n := (i % ch_n) + 1;
      v_city_id := ch_ids[n]; v_clat := ch_lats[n]; v_clng := ch_lngs[n];
    ELSIF v_cc = 'AR' THEN
      n := (i % ar_n) + 1;
      v_city_id := ar_ids[n]; v_clat := ar_lats[n]; v_clng := ar_lngs[n];
    ELSE
      n := (i % mx_n) + 1;
      v_city_id := mx_ids[n]; v_clat := mx_lats[n]; v_clng := mx_lngs[n];
    END IF;

    -- Jitter ±0.08° (~9 km) around city center
    v_lat := v_clat + (random() - 0.5) * 0.16;
    v_lng := v_clng + (random() - 0.5) * 0.16;

    INSERT INTO users
      (email, email_lookup_hash, name, birth_year, gender, interested_in,
       city_id, country_code, email_verified, is_active)
    VALUES
      (pgp_sym_encrypt(v_email, enc_key), v_hash, v_name, v_birth, v_gender,
       v_ints, v_city_id, v_cc, true, true)
    RETURNING id INTO v_uid;

    INSERT INTO pixels
      (user_id, city_id, country_code, type, lat, lng, color, is_active, expires_at)
    VALUES
      (v_uid, v_city_id, v_cc, 'person', v_lat, v_lng, v_color, true,
       now() + interval '365 days');

  END LOOP;

  RAISE NOTICE 'Done — 2300 demo pixels inserted.';
END $$;
