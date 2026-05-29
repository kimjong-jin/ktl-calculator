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

## 도구 4종

| 도구 | 입력 | 설명 |
|------|------|------|
| `list_test_items` | — | 검사 항목과 수수료(원) 목록 |
| `get_test_fee` | `item` | 특정 항목 수수료 조회 (대소문자 무관) |
| `get_sheet_data` | `sheetName?` | 시트 원본 데이터(생략 시 시트 목록) |
| `calculate_accuracy` | `parameter`, `measured`, `standard` | 오차율 계산 + 합격 판정 |

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

## 구조

```
src/
├── index.js        # MCP stdio 서버 (도구 4종 등록)
├── excelClient.js  # Version11_(2026).xlsx 파싱 (xlsx)
└── calculator.js   # 오차율 계산 (순수 함수)
```
