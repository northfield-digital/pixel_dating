/**
 * Seed demo pixels to make the map look populated.
 * Defaults to 2300 bots spread across ES / CH / AR / MX.
 *
 * Usage (from backend/):
 *   npx tsx scripts/seed-demo-pixels.ts            # creates 2300
 *   npx tsx scripts/seed-demo-pixels.ts --count=500
 *   npx tsx scripts/seed-demo-pixels.ts --wipe      # removes previous demo bots first
 *
 * Bots use emails ending @dev.pixeldating.test so the existing
 * DELETE /api/dev/wipe-bots endpoint can clean them up.
 */
import 'dotenv/config';
import pg from 'pg';
import { resolve4 } from 'dns/promises';
import { computeEmailHash } from '../src/lib/emailHash.js';

// Build a pool that connects over IPv4 even when the hostname resolves to IPv6 first.
async function makeIPv4Pool() {
  const url = new URL(process.env.DATABASE_URL!);
  let host = url.hostname;
  try {
    const addrs = await resolve4(host);
    host = addrs[0]; // use first IPv4 address
  } catch {
    // fall back to original hostname
  }
  return new pg.Pool({
    host,
    port: parseInt(url.port || '5432', 10),
    database: url.pathname.slice(1),
    user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    ssl: { rejectUnauthorized: false },
    max: 10,
  });
}

const arg = (flag: string) => process.argv.find(a => a.startsWith(`--${flag}=`))?.split('=')[1];
const TARGET = parseInt(arg('count') ?? '2300', 10);
const WIPE   = process.argv.includes('--wipe');

// ─── Names (gender-matched) ────────────────────────────────────────────────
const MALE_NAMES = [
  // Spanish / Latin American
  'Alejandro','Diego','Mateo','Santiago','Sebastián','Nicolás','Andrés','Gabriel',
  'Julián','Carlos','Roberto','Javier','Miguel','Pablo','Jorge','Alberto','Fernando',
  'Rafael','Hugo','Marcos','Rodrigo','Emilio','Manuel','Luis','Ramón','Felipe',
  'Ignacio','Tomás','Arturo','Eduardo','Adrián','Héctor','Víctor','Gustavo','Mauricio',
  'Raúl','Sergio','Óscar','Armando','Cristian','Francisco','Daniel','José',
  'Antonio','Jesús','Mario','Pedro','Ricardo','Enrique','Alfonso','Agustín','Bruno',
  'César','Darío','Esteban','Gonzalo','Leandro','Lucas','Marcelo','Martín',
  'Octavio','Omar','Patricio','Renato','Ramiro','Salvador','Valentín','Iván',
  'Rubén','Claudio','Gerardo','Gustavo','Hernán','Lorenzo','Nahuel','Thiago',
  'Ezequiel','Facundo','Maximiliano','Nicolás','Federico','Gastón',
  // Swiss / German / French
  'Klaus','Hans','Stefan','Michael','Andreas','Thomas','Markus','Peter','Christian',
  'Philipp','Simon','Dominik','Lukas','Florian','Tobias','Patrick','Oliver','Martin',
  'Felix','Jonas','Christoph','Benjamin','Samuel','Fabian','Aaron','Noah','Leon',
  'Marc','Jan','Elias','Alexander','Antoine','Baptiste','François','Guillaume',
  'Henri','Maxime','Pierre','Vincent','Xavier','Yann','Luca','Davide','Marco',
  'Giovanni','Riccardo','Matteo','Andrea',
];

const FEMALE_NAMES = [
  // Spanish / Latin American
  'Sofía','Valentina','Camila','Lucía','Isabella','Emma','Martina','Valeria',
  'Daniela','Paula','María','Laura','Ana','Sara','Elena','Carmen','Rosa','Clara',
  'Nora','Julia','Claudia','Adriana','Alicia','Andrea','Ángela','Beatriz','Carla',
  'Catalina','Cecilia','Diana','Estela','Fernanda','Gabriela','Gloria','Helena',
  'Inés','Irene','Jimena','Josefina','Leticia','Lorena','Magdalena','Manuela',
  'Mercedes','Mireya','Mónica','Natalia','Patricia','Pilar','Raquel','Rebeca',
  'Renata','Rocío','Sonia','Susana','Teresa','Verónica','Viviana','Ximena',
  'Yolanda','Ariana','Carolina','Isabel','Lola','Miriam','Sandra','Mariana',
  'Alejandra','Alondra','Brenda','Fabiola','Graciela','Karina','Paola',
  'Florencia','Agustina','Micaela','Romina','Sabrina','Vanesa','Celeste',
  // Swiss / German / French
  'Anna','Maria','Sarah','Lisa','Lena','Nicole','Katharina','Christina','Sabine',
  'Franziska','Monika','Stefanie','Angela','Bianca','Caroline','Elisabeth',
  'Eva','Heidi','Ingrid','Jana','Karin','Linda','Margarete','Nina','Petra',
  'Silke','Tanja','Ursula','Verena','Sophie','Émilie','Camille','Charlotte',
  'Chloe','Juliette','Margaux','Mathilde','Pauline','Zoé','Giulia','Chiara',
  'Federica','Alessia','Francesca',
];

const NB_NAMES = [
  'Alex','Jordan','Sam','Morgan','Taylor','Riley','Casey','Quinn','Dakota','Avery',
  'Skyler','Robin','Jesse','Charlie','Blair','Emery','Finley','Hayden','Jamie','Kai',
  'Lane','Marley','Parker','Remy','Rowan','Scout','Spencer','Sydney','Elliot',
  'River','Phoenix','Sage','Eden','Indigo','Sasha','Nico','Mika','René',
];

// ─── Gender / interest pools ───────────────────────────────────────────────
const GENDERS: Array<{ g: string; color: string; names: string[] }> = [
  { g: 'male',       color: '#6B9FD4', names: MALE_NAMES   },
  { g: 'male',       color: '#6B9FD4', names: MALE_NAMES   }, // 2× weight
  { g: 'female',     color: '#E06878', names: FEMALE_NAMES },
  { g: 'female',     color: '#E06878', names: FEMALE_NAMES }, // 2× weight
  { g: 'non-binary', color: '#B07FC8', names: NB_NAMES     },
  { g: 'other',      color: '#B07FC8', names: [...NB_NAMES, ...MALE_NAMES.slice(0, 10)] },
];

const INTEREST_POOLS: string[][] = [
  ['female'], ['male'], ['female', 'non-binary'], ['male', 'non-binary'],
  ['male', 'female'], ['male', 'female', 'non-binary'],
];

// ─── Country distribution (pct → count) ──────────────────────────────────
// ES 30 % · CH 10 % · AR 35 % · MX 25 %
const COUNTRY_SHARE: Record<string, number> = { ES: 0.30, CH: 0.10, AR: 0.35, MX: 0.25 };

// ─── Helpers ──────────────────────────────────────────────────────────────
function pick<T>(arr: T[], seed: number): T {
  return arr[seed % arr.length];
}

function jitter(center: number, spread: number): number {
  // Deterministic-ish spread: combine seed-based approach with some variation
  return center + (Math.random() - 0.5) * spread * 2;
}

// ─── Main ─────────────────────────────────────────────────────────────────
async function main() {
  if (!process.env.EMAIL_ENCRYPTION_KEY) throw new Error('EMAIL_ENCRYPTION_KEY not set');
  if (!process.env.EMAIL_HASH_KEY)        throw new Error('EMAIL_HASH_KEY not set');

  const pool = await makeIPv4Pool();
  const client = await pool.connect();
  try {
    if (WIPE) {
      console.log('[seed] wiping existing demo bots…');
      const bots = await client.query<{ id: string }>(
        `SELECT u.id FROM users u
         WHERE pgp_sym_decrypt(u.email, $1) LIKE '%@dev.pixeldating.test'
           AND u.deleted_at IS NULL`,
        [process.env.EMAIL_ENCRYPTION_KEY],
      );
      for (const { id } of bots.rows) {
        await client.query(`UPDATE pixels SET is_active = false WHERE user_id = $1`, [id]);
        await client.query(`UPDATE users  SET deleted_at = now() WHERE id = $1`, [id]);
      }
      console.log(`[seed] removed ${bots.rows.length} existing bots`);
    }

    // Load cities, weighted by soft_capacity
    const citiesRes = await client.query<{
      id: number; country_code: string; lat: number; lng: number; soft_capacity: number;
    }>(`SELECT id, country_code, lat, lng, soft_capacity FROM cities ORDER BY country_code, soft_capacity DESC`);

    const citiesByCountry: Record<string, typeof citiesRes.rows> = {};
    for (const row of citiesRes.rows) {
      citiesByCountry[row.country_code] ??= [];
      citiesByCountry[row.country_code].push(row);
    }

    // Build weighted city pick for each country
    function pickCity(cc: string, seed: number) {
      const list = citiesByCountry[cc] ?? [];
      if (!list.length) throw new Error(`No cities for country ${cc}`);
      // Weight proportional to soft_capacity
      const total = list.reduce((s, c) => s + c.soft_capacity, 0);
      let r = (seed * 7919 % total); // deterministic pseudo-random
      for (const c of list) {
        r -= c.soft_capacity;
        if (r <= 0) return c;
      }
      return list[list.length - 1];
    }

    // Decide how many bots per country
    const byCc: Record<string, number> = {};
    let assigned = 0;
    const ccList = Object.keys(COUNTRY_SHARE);
    for (let i = 0; i < ccList.length - 1; i++) {
      const cc = ccList[i];
      byCc[cc] = Math.round(TARGET * COUNTRY_SHARE[cc]);
      assigned += byCc[cc];
    }
    byCc[ccList[ccList.length - 1]] = TARGET - assigned;

    console.log('[seed] distribution:', byCc);

    let created = 0;
    let errors  = 0;
    const ts = Date.now();

    // Insert concurrently in batches of 20 per country
    for (const [cc, count] of Object.entries(byCc)) {
      console.log(`[seed] → ${cc}: ${count} bots…`);

      const BATCH = 20;
      for (let base = 0; base < count; base += BATCH) {
        const tasks: Promise<void>[] = [];

        for (let j = 0; j < BATCH && base + j < count; j++) {
          const i = base + j;
          const task = (async () => {
            const gSlot    = GENDERS[i % GENDERS.length];
            const gender   = gSlot.g;
            const color    = gSlot.color;
            const name     = pick(gSlot.names, i + base * 3);
            const email    = `demo_${cc.toLowerCase()}_${ts}_${i}@dev.pixeldating.test`;
            const hash     = computeEmailHash(email);
            const interests = pick(INTEREST_POOLS, i + 1);
            const birthYear = 1985 + (i % 18); // ages ~24–41

            const city     = pickCity(cc, i * 13 + base);
            // Spread pixel ±0.08° (~9 km) from city center to cluster around cities naturally
            const lat = jitter(Number(city.lat), 0.08);
            const lng = jitter(Number(city.lng), 0.08);

            try {
              const uRes = await client.query<{ id: string }>(
                `INSERT INTO users
                   (email, email_lookup_hash, name, birth_year, gender, interested_in,
                    city_id, country_code, email_verified, is_active)
                 VALUES
                   (pgp_sym_encrypt($1, $2), $3, $4, $5, $6, $7, $8, $9, true, true)
                 RETURNING id`,
                [
                  email, process.env.EMAIL_ENCRYPTION_KEY, hash,
                  name, birthYear, gender, interests,
                  city.id, cc,
                ],
              );
              const userId = uRes.rows[0].id;

              await client.query(
                `INSERT INTO pixels (user_id, city_id, country_code, type, lat, lng, color, is_active, expires_at)
                 VALUES ($1, $2, $3, 'person', $4, $5, $6, true, now() + interval '365 days')`,
                [userId, city.id, cc, lat, lng, color],
              );
              created++;
            } catch (err) {
              errors++;
              if (errors <= 5) console.error(`  [!] bot ${cc}_${i}:`, (err as Error).message);
            }
          })();
          tasks.push(task);
        }

        await Promise.all(tasks);
        process.stdout.write(`\r  ${cc}: ${Math.min(base + BATCH, count)}/${count}`);
      }
      console.log();
    }

    console.log(`\n[seed] done — created ${created} bots, ${errors} errors`);
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error('[seed] fatal:', err);
  process.exit(1);
});
