-- Ameen customer balances and allowed debit limits.
-- Read-only. It does not write anything inside Al-Ameen.
--
-- Expected output for the sync agent:
--   customer_name   : customer display name
--   balance         : current customer balance, debit minus credit
--   credit_limit    : allowed debit limit from cu000.MaxDebit
--   remaining_limit : credit_limit minus balance
--   last_payment_amount : last credit movement on the customer account
--   last_payment_date   : date of the last credit movement

select
  cu.CustomerName as customer_name,
  cast(coalesce(cu.Debit, 0) - coalesce(cu.Credit, 0) as decimal(18, 3)) as balance,
  cast(coalesce(nullif(cu.MaxDebit, 0), nullif(ac.MaxDebit, 0), 0) as decimal(18, 3)) as credit_limit,
  cast(coalesce(nullif(cu.MaxDebit, 0), nullif(ac.MaxDebit, 0), 0) - (coalesce(cu.Debit, 0) - coalesce(cu.Credit, 0)) as decimal(18, 3)) as remaining_limit,
  cu.GUID as customer_guid,
  cast(coalesce(last_payment.last_payment_amount, 0) as decimal(18, 3)) as last_payment_amount,
  last_payment.last_payment_date,
  last_payment.last_payment_notes
from dbo.cu000 cu
left join dbo.ac000 ac
  on ac.GUID = cu.AccountGUID
outer apply (
  select top 1
    en.Credit as last_payment_amount,
    en.Date as last_payment_date,
    en.Notes as last_payment_notes
  from dbo.en000 en
  where
    en.AccountGUID = cu.AccountGUID
    and coalesce(en.Credit, 0) > 0
    and coalesce(en.Type, 0) = 0
  order by
    en.Date desc,
    en.Number desc,
    en.GUID desc
) last_payment
where
  cu.CustomerName is not null
  and ltrim(rtrim(cu.CustomerName)) <> ''
  and (cu.bHide is null or cu.bHide = 0)
order by
  balance desc,
  cu.CustomerName;
