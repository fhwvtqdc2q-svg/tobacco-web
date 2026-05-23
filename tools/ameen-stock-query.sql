-- Ameen live stock query for Al-Ameen 9 / AmnDb001.
-- Read-only. It does not write anything inside Al-Ameen.
--
-- Expected output for the sync agent:
--   item_name : material name
--   stock_qty : current sellable quantity across warehouses
--   stock_qty_net : net quantity across warehouses
--   stock_qty_positive : sum of positive warehouse quantities
--   unit1_name : first/default Ameen unit name
--   unit2_name : second pricing unit name
--   unit2_factor : how many unit1 items are inside one unit2 item
--   group_name : material group name

with stock_by_material as (
  select
    MatGUID,
    sum(coalesce(Qty, 0)) as stock_qty_net,
    sum(case when coalesce(Qty, 0) > 0 then Qty else 0 end) as stock_qty_positive
  from dbo.ms000
  group by MatGUID
)
select
  mt.Name as item_name,
  nullif(ltrim(rtrim(gr.Name)), '') as group_name,
  cast(
    case
      when coalesce(stock.stock_qty_positive, 0) > 0 then stock.stock_qty_positive
      else coalesce(stock.stock_qty_net, mt.Qty, 0)
    end
    as decimal(18, 3)
  ) as stock_qty,
  cast(coalesce(stock.stock_qty_net, mt.Qty, 0) as decimal(18, 3)) as stock_qty_net,
  cast(coalesce(stock.stock_qty_positive, 0) as decimal(18, 3)) as stock_qty_positive,
  nullif(ltrim(rtrim(mt.Unity)), '') as unit1_name,
  nullif(ltrim(rtrim(mt.Unit2)), '') as unit2_name,
  cast(
    case
      when coalesce(mt.Unit2Fact, 0) > 0 then mt.Unit2Fact
      else 1
    end
    as decimal(18, 3)
  ) as unit2_factor
from dbo.mt000 mt
left join dbo.gr000 gr
  on gr.GUID = mt.GroupGUID
left join stock_by_material stock
  on stock.MatGUID = mt.GUID
where
  mt.Name is not null
  and ltrim(rtrim(mt.Name)) <> ''
order by
  mt.Name;
