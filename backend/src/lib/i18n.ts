/**
 * Lightweight backend-side i18n for transactional emails.
 *
 * We support the same three languages as the frontend (en, es, pt) and
 * pick one based on the recipient's `users.lang` column. Strings are
 * intentionally short and template-like; substitutions are denoted by
 * {placeholder} and replaced via `t(lang, key, vars)`.
 */
export type Lang = 'en' | 'es' | 'pt';

export const SUPPORTED_LANGS: readonly Lang[] = ['en', 'es', 'pt'] as const;

export function detectLang(input: string | null | undefined): Lang {
  if (!input) return 'en';
  // Accept-Language can be "es-ES,es;q=0.9,en;q=0.8" — take the first 2 chars.
  const tag = input.toLowerCase().slice(0, 2);
  if (tag === 'es') return 'es';
  if (tag === 'pt') return 'pt';
  return 'en';
}

type Dict = Record<string, string>;

const STRINGS: Record<Lang, Dict> = {
  en: {
    'verification.subject': 'Verify your email · Pixel Dating',
    'verification.title': 'Verify your email',
    'verification.body': 'Click the link below to verify your account and place your pixel on the map.',
    'verification.cta': 'Verify my email',
    'verification.expiry': 'This link expires in 24 hours.',

    'login.subject': 'Sign in to Pixel Dating',
    'login.title': 'Sign in to your account',
    'login.body': 'Click the link below to sign in to your Pixel Dating account. The link expires in 1 hour.',
    'login.cta': 'Sign in',

    'incomingLike.subject': 'Someone clicked your pixel',
    'incomingLike.title': 'You got a click!',
    'incomingLike.body': 'Someone in {city} just clicked your pixel. Open your inbox to accept or reject within 24 hours.',
    'incomingLike.cta': 'Open inbox',

    'match.subject': 'New match on Pixel Dating',
    'match.title': "It's a match!",
    'match.body': 'You and {name} both said yes. Reach out at {email} to take it from here.',

    'likeExpired.subject': 'Your click expired',
    'likeExpired.body': 'Your click in {city} expired without a response. You have your daily clicks back.',

    'pixelActive.subject': 'Your pixel is live',
    'pixelActive.body': 'Your pixel in {city} is now visible on the map.',
    'pixelActive.cta': 'See it on the map',

    'pixelExpired.subject': 'Your pixel expired',
    'pixelExpired.body': 'Your pixel in {city} just expired. Place a new one to stay on the map.',
    'pixelExpired.cta': 'Place a new pixel',

    'accountDeleted.subject': 'Your Pixel Dating account was deleted',
    'accountDeleted.body': 'Your account has been deleted. We have erased your profile data and disabled your pixels.',
  },
  es: {
    'verification.subject': 'Verifica tu email · Pixel Dating',
    'verification.title': 'Verifica tu email',
    'verification.body': 'Haz clic en el enlace para verificar tu cuenta y colocar tu píxel en el mapa.',
    'verification.cta': 'Verificar mi email',
    'verification.expiry': 'Este enlace caduca en 24 horas.',

    'login.subject': 'Inicia sesión en Pixel Dating',
    'login.title': 'Inicia sesión en tu cuenta',
    'login.body': 'Haz clic en el enlace para iniciar sesión en tu cuenta de Pixel Dating. El enlace caduca en 1 hora.',
    'login.cta': 'Iniciar sesión',

    'incomingLike.subject': 'Alguien hizo clic en tu píxel',
    'incomingLike.title': '¡Recibiste un clic!',
    'incomingLike.body': 'Alguien en {city} acaba de hacer clic en tu píxel. Abre tu bandeja para aceptar o rechazar en 24 horas.',
    'incomingLike.cta': 'Abrir bandeja',

    'match.subject': 'Nuevo match en Pixel Dating',
    'match.title': '¡Es un match!',
    'match.body': 'Tú y {name} dijisteis sí. Escríbele a {email} para seguir desde ahí.',

    'likeExpired.subject': 'Tu clic ha caducado',
    'likeExpired.body': 'Tu clic en {city} ha caducado sin respuesta. Recuperas tus clics del día.',

    'pixelActive.subject': 'Tu píxel está activo',
    'pixelActive.body': 'Tu píxel en {city} ya es visible en el mapa.',
    'pixelActive.cta': 'Verlo en el mapa',

    'pixelExpired.subject': 'Tu píxel ha caducado',
    'pixelExpired.body': 'Tu píxel en {city} ha caducado. Coloca uno nuevo para seguir en el mapa.',
    'pixelExpired.cta': 'Colocar un nuevo píxel',

    'accountDeleted.subject': 'Tu cuenta de Pixel Dating ha sido eliminada',
    'accountDeleted.body': 'Hemos eliminado tu cuenta y los datos asociados, y desactivado tus píxeles.',
  },
  pt: {
    'verification.subject': 'Confirme o seu e-mail · Pixel Dating',
    'verification.title': 'Confirme o seu e-mail',
    'verification.body': 'Clique no link abaixo para confirmar a sua conta e colocar o seu pixel no mapa.',
    'verification.cta': 'Confirmar e-mail',
    'verification.expiry': 'Este link expira em 24 horas.',

    'login.subject': 'Entrar no Pixel Dating',
    'login.title': 'Entre na sua conta',
    'login.body': 'Clique no link abaixo para entrar na sua conta Pixel Dating. O link expira em 1 hora.',
    'login.cta': 'Entrar',

    'incomingLike.subject': 'Alguém clicou no seu pixel',
    'incomingLike.title': 'Você recebeu um clique!',
    'incomingLike.body': 'Alguém em {city} acabou de clicar no seu pixel. Abra a caixa de entrada para aceitar ou rejeitar em 24 horas.',
    'incomingLike.cta': 'Abrir caixa de entrada',

    'match.subject': 'Novo match no Pixel Dating',
    'match.title': 'É um match!',
    'match.body': 'Você e {name} disseram sim. Escreva para {email} para continuar a conversa.',

    'likeExpired.subject': 'O seu clique expirou',
    'likeExpired.body': 'O seu clique em {city} expirou sem resposta. Os cliques do dia foram restaurados.',

    'pixelActive.subject': 'O seu pixel está no ar',
    'pixelActive.body': 'O seu pixel em {city} já aparece no mapa.',
    'pixelActive.cta': 'Ver no mapa',

    'pixelExpired.subject': 'O seu pixel expirou',
    'pixelExpired.body': 'O seu pixel em {city} expirou. Coloque outro para continuar no mapa.',
    'pixelExpired.cta': 'Colocar novo pixel',

    'accountDeleted.subject': 'A sua conta Pixel Dating foi apagada',
    'accountDeleted.body': 'A sua conta foi apagada, os dados pessoais removidos e os pixels desativados.',
  },
};

export function t(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const dict = STRINGS[lang] ?? STRINGS.en;
  let s = dict[key] ?? STRINGS.en[key] ?? key;
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}
