# Spreadsheet data contract

The dashboard is read-only. It never writes to the source workbook.

## CATEGORY OF SALES V2

The sales repository validates the following source fields before it builds the shared cache.

| Purpose | Sheet field | Current column |
|---|---|---:|
| Final source/lender branch | Final Branch (SOURCE) | H |
| Company monthly target | Monthly DS Target | J |
| Region monthly target | Monthly Region Sales Target | K |
| Branch monthly target | Monthly Branch Sales Target | L |
| Company achievement contribution | %ach DS | M |
| Region achievement contribution | %ach Region | N |
| Branch achievement contribution | %ach Branch | O |
| TDC lent slots | Daily TDC Lent Slots | X |
| TDC allocation / used | TDC allocation and used fields | Z / AA |
| PDC lent slots | Daily PDC Lent Slots | AH |
| PDC allocation / used | PDC allocation and used fields | AJ / AK |
| Collection region | Region (Collection Branch) | AZ |
| Collection / borrower branch | COLLECTION BRANCH | BA |
| Transaction date | TRANSACTION DATE | BB |
| Source input fallback | SOURCE | BC |
| Service | General Service Type / Service cleaner | D / BF |
| Transactions | COUNTA of Service type Cleaner | BH |
| Amount | AMOUNT | BI |
| Remarks | Remarks | BJ |

### Slot-sharing rule

A record is an identified slot-sharing relationship when:

1. the service is TDC/OTDC or PDC;
2. the source branch is known;
3. the source branch differs from the collection branch.

The source branch uses **Final Branch (SOURCE)** first and **SOURCE** as a fallback. Rows with a positive lent-slot value but an unknown source are retained as `Source branch pending`; they are not assigned to a lender.

## DISBURSEMENT

The expense repository discovers columns by header name instead of fixed letters. Required headers are:

- `BRANCH`
- `DISBURSED DATE`
- `LIQUIDATED EXPENSE`, `EXPENSE AMOUNT`, or `AMOUNT`

Optional headers include `REGION`, `TYPE OF EXPENSE`, and `GL DESCRIPTION`. This allows inserted columns such as `CH` without shifting the parser.

## CUSTOMER TYPE V2

The customer repository currently expects the existing branch, transaction-date, count, and customer-type layout. Update `CustomerRepository.gs` if Accounting changes those headers.

## Reporting rules

- Overview encoded collections use all encoded records.
- SLSAch%-aligned monthly and achievement reporting uses the J:O contribution fields and excludes `NON` and `REPRINT` where the pivot excludes them.
- The dedicated Sales Trends view excludes `NON` and `REPRINT`.
- Weekly series use Sunday through Saturday, matching `DlySLSTrd`.
