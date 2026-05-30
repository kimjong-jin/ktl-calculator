# KTL 정도검사 계산기 MCP 서버

수질 TMS 정도검사용 수수료 조회 및 오차율 계산을 제공하는 MCP(stdio) 서버.
엑셀 DB `Version11_(2026).xlsx`를 데이터 소스로 사용한다.
(환경변수 `KTL_DATA_FILE`로 경로 교체 가능, 없으면 `data.xlsx`로 폴백)

## 실행

```bash
npm install
npm start        # stdio MCP 서버 기동
npm test         # 핵심 로직 스모크 테스트
```

## 도구 6종

| 도구 | 입력 | 설명 |
|------|------|------|
| `list_test_items` | — | 검사 항목과 수수료(원) 목록 |
| `get_test_fee` | `item` | 특정 항목 수수료 조회 (대소문자 무관) |
| `get_sheet_data` | `sheetName?` | 시트 원본 데이터(생략 시 시트 목록) |
| `calculate_accuracy` | `parameter`, `measured`, `standard` | 오차율 계산 + 합격 판정 |
| `list_claydox_targets` | `param?` | 파라미터별 Claydox target→셀 매핑(생략 시 파라미터 목록) |
| `build_claydox_payload` | `param`, `values?` | Claydox phpEXCEL 전송 페이로드 생성 |

## 오차율 계산

```
오차율(%) = |측정값 - 표준값| / 표준값 × 100
```

| 파라미터 | 합격 기준 |
|---------|-----------|
| TOC, TN, TP, SS, COD | 오차율 ±10% 이내 |
| pH | 편차 ±0.3 이내 (절대값) |
| DO | 편차 ±0.5 이내 (절대값) |

기준이 정의되지 않은 파라미터는 수치만 계산하고 판정은 `-`로 반환한다.

## Claydox 페이로드 생성

`claydoxMappings.js`는 9개 파라미터(TOC·TN·TP·COD·SS·pH·DO·Cl·TU)의
target(논리명)→엑셀 셀/시트 매핑을 담는다. `build_claydox_payload`는
target→값 매핑을 받아 Claydox phpEXCEL 전송 페이로드로 변환한다.
(파라미터는 대소문자 무관, 미입력 target은 빈 문자열로 채워진다.)

```json
// 입력: param="TOC", values={ "M1": 1.23 }
{
  "phpEXCEL": {
    "FILE_UID": "excel",
    "INPUT_DATA": [
      { "target": "M1", "cellName": "D12", "sheetName": "Sheet1", "targetType": "multi_text", "value": "1.23" }
    ]
  }
}
```

## MCP 클라이언트 등록 예시

```json
{
  "mcpServers": {
    "ktl-calculator": {
      "command": "node",
      "args": ["/Users/kimjongjin/coding/calculator-main/src/index.js"]
    }
  }
}
```

## 웹 UI (Vite + vanilla JS)

```bash
npm run dev      # 개발 서버 (http://localhost:3001)
npm run build    # dist/ 정적 빌드
npm run preview  # 빌드 결과 미리보기
```

서버사이드 계산/DB 로직(`calculator.js`·`excelClient.js`)을 `vite.config.js`
미들웨어로 `/api`에 노출하여 프런트가 호출한다(계산·DB는 서버 단일 출처 SSOT).

- **엑셀 DB 연동 상태 칩** — `GET /api/db/status`로 파일명·시트수·항목수를 표시
  (절대경로·내부 에러는 노출하지 않음)
- **판정 결과 hero** — 판정 배지 + 대형 오차율 + 보조 지표. TU·Cl은 판정 기준이
  없어 `판정 비대상 · 수치만 계산` 배지로 표시(판정값 `'-'`)
- **계산 이력** — localStorage 영속(이 브라우저, 최대 200건), 개별/전체 삭제,
  **CSV·JSON 내보내기**(클라이언트 Blob 생성, DB 원본 파일은 제공하지 않음)
- **라이트/다크 테마 토글**, 모바일 우선 반응형(터치 44px)

## 구조

```
src/
├── index.js            # MCP stdio 서버 (도구 6종 등록)
├── excelClient.js      # Version11_(2026).xlsx 파싱 + getDataFileName()
├── calculator.js       # 오차율 계산 (순수 함수)
└── claydoxMappings.js  # Claydox target→셀 매핑 + 페이로드 생성

web/
├── index.html          # 3-영역 레이아웃 (입력 / 판정 / 이력)
├── style.css           # 토큰 기반 다크·라이트 테마
├── constants.js        # 항목·기준 안내·파라미터 색상
├── api.js              # /api 호출 래퍼
├── history.js          # 계산 이력 localStorage CRUD
├── exporter.js         # 이력 CSV·JSON 내보내기
├── render.js           # 판정 hero·이력·연동 칩 DOM 렌더
└── main.js             # 진입점 (바인딩·흐름 제어)
```
