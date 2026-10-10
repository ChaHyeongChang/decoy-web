// 개인정보 처리방침 /privacy (M15, docs/MOBILE_PLAN.md M15 1번). client/public/privacy.html을 내되,
// 문의처 자리(<!--contact--> … <!--/contact-->)를 배포 환경 변수 PRIVACY_CONTACT로 바꿔 넣는다(Render 대시보드에서 넣는다).
// 값이 없으면 문서에 적힌 기본 문구("구글 플레이 스토어의 개발자 연락처로 문의") 그대로.
// 파일이 없으면 404 — 게임 HTML로 새지 않게. /privacy.html도 같은 응답(서비스 워커가 앱 셸로 받아 오프라인에서 쓰는 주소)
import { existsSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gzipSync } from 'node:zlib';
import type { ServerResponse } from 'node:http';
import { acceptsGzip } from './static';

export const PRIVACY_PATHS: readonly string[] = ['/privacy', '/privacy.html'];
export const PRIVACY_FILE = 'privacy.html';
export const PRIVACY_CONTACT_ENV = 'PRIVACY_CONTACT';
/** 문의처가 너무 길면(실수로 다른 값을 넣었을 때) 쓰지 않는다 */
const CONTACT_MAX = 200;
const CONTACT_MARK = /<!--contact-->[\s\S]*?<!--\/contact-->/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

function escapeHtml(s: string): string {
  return s
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

/** 문의처 HTML 조각: 이메일이면 mailto 링크, 그 밖은 글자 그대로(이스케이프). 비었거나 너무 길면 null */
export function contactHtml(raw: string | undefined): string | null {
  const v = (raw ?? '').trim();
  if (v === '' || v.length > CONTACT_MAX) return null;
  const text = escapeHtml(v);
  return EMAIL.test(v) ? `<a href="mailto:${text}">${text}</a>` : text;
}

/** 문의처 자리를 바꿔 넣은 문서. contact가 null이면 원문 그대로 */
export function renderPrivacy(html: string, contact: string | null): string {
  if (contact === null) return html;
  return html.replace(CONTACT_MARK, () => `<!--contact-->${contact}<!--/contact-->`);
}

interface Rendered {
  mtimeMs: number;
  size: number;
  body: Buffer;
  gz: Buffer;
}

/** 처리방침 응답기. 파일이 바뀌면(개발 중 다시 빌드) 다시 읽는다 */
export function privacyHandler(
  root: string,
  env: Record<string, string | undefined>,
): (res: ServerResponse, acceptEncoding: string | string[] | undefined) => void {
  const contact = contactHtml(env[PRIVACY_CONTACT_ENV]);
  let cached: Rendered | null = null;
  return (res, acceptEncoding) => {
    const file = join(root, PRIVACY_FILE);
    if (!existsSync(file)) {
      res
        .writeHead(404, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
        .end('not found');
      return;
    }
    const st = statSync(file);
    if (!cached || cached.mtimeMs !== st.mtimeMs || cached.size !== st.size) {
      const body = Buffer.from(renderPrivacy(readFileSync(file, 'utf8'), contact), 'utf8');
      cached = { mtimeMs: st.mtimeMs, size: st.size, body, gz: gzipSync(body) };
    }
    const headers: Record<string, string> = {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-cache',
      vary: 'Accept-Encoding',
    };
    if (acceptsGzip(acceptEncoding))
      res
        .writeHead(200, {
          ...headers,
          'content-encoding': 'gzip',
          'content-length': String(cached.gz.length),
        })
        .end(cached.gz);
    else res.writeHead(200, { ...headers, 'content-length': String(cached.body.length) }).end(cached.body);
  };
}
