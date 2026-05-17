-- Ameen customer balances and allowed debit limits.
-- Read-only. It does not write anything inside Al-Ameen.
--
-- Expected output for the sync agent:
--   customer_name   : customer display name
--   balance         : current customer balance, debit minus credit
--   credit_limit    : allowed debit limit from cu000.MaxDebit
--   remaining_limit : credit_limit minus balance

select
  cu.CustomerName as customer_name,
  cast(coalesce(cu.Debit, 0) - coalesce(cu.Credit, 0) as decimal(18, 3)) as balance,
  cast(coalesce(nullif(cu.MaxDebit, 0), nullif(ac.MaxDebit, 0), 0) as decimal(18, 3)) as credit_limit,
  cast(coalesce(nullif(cu.MaxDebit, 0), nullif(ac.MaxDebit, 0), 0) - (coalesce(cu.Debit, 0) - coalesce(cu.Credit, 0)) as decimal(18, 3)) as remaining_limit,
  cu.GUID as customer_guid
from dbo.cu000 cu
left join dbo.ac000 ac
  on ac.GUID = cu.AccountGUID
where
  cu.CustomerName is not null
  and ltrim(rtrim(cu.CustomerName)) <> ''
  and (cu.bHide is null or cu.bHide = 0)
order by
  balance desc,
  cu.CustomerName;
