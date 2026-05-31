# KTL 정도검사 계산기 — 개발 규칙

## 프로젝트 개요
수질TMS 정도검사(반복성·직선성·응답시간·현장적용계수·배출기준) 계산기.
- **DB**: `Version11_(2026).xlsx` (엑셀 기반, xlsx 파싱)
- **배포**: Vercel 정적 빌드 + 서버리스 API (`/api/**/*.js`)
- **스택**: Vite + Vanilla JS (ESM), Node.js serverless functions

## 아키텍처 핵심
```
web/          → 프론트엔드 (HTML/CSS/JS)
src/          → 공유 비즈니스 로직 (브라우저·서버 양쪽 임포트)
api/          → Vercel 서버리스 엔드포인트
api/db/       → DB 상태·데이터 조회 엔드포인트
```
- `src/excelClient.js` = 엑셀 파싱 싱글턴 (서버리스에서만 동작)
- `src/authService.js` = 인증 순수 함수 (브라우저·서버 공유)
- `src/calculator.js` = 측정 계산 핵심 로직

## 시니어 개발자 프로세스 (필수 준수)

### 코드 변경 전
1. 관련 파일 먼저 읽고 기존 패턴 파악
2. 변경 범위 명확히 정의 — "최소 변경"이 기본값
3. 사이드이펙트 경로 확인 (특히 공유 `src/` 모듈)

### TDD 원칙
- 로직 변경 시 `test/` 아래 smoke·precision 테스트 먼저 확인
- 계산 공식 수정 → `npm test` 통과 필수
- 새 계산 로직 추가 → 테스트 케이스도 함께 추가

### 코드 품질 규칙
- 주석은 WHY만 (WHAT은 코드가 설명)
- 한 함수 = 한 책임
- `src/` 모듈은 순수 함수 유지 (부수효과 금지)
- Vercel 서버리스: 환경변수는 `process.env.*`로만 접근

## 금지 사항
- `console.log` 디버그 코드 커밋 금지
- `api/` 파일에 비밀키 하드코딩 금지
- `dist/` 직접 편집 금지 (빌드 산출물)
- `node_modules/` 편집 금지

## 자주 쓰는 커맨드
```bash
npm run dev      # 로컬 개발서버
npm run build    # 프로덕션 빌드
npm test         # smoke + precision 테스트
```

## API 엔드포인트 목록
- `POST /api/auth` — 로그인
- `GET  /api/auth?token=` — 토큰 검증
- `GET  /api/db/status` — DB 연결 상태
- `POST /api/gemini` — AI 채팅 (Gemini)
- `GET  /api/lawSearch` — 법령 검색
