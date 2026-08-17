-- Ameen live stock query for Al-Ameen 9 / AmnDb002. Read-only, bills-based.
with per_store as (
  select bi.MatGUID, bi.StoreGUID,
    sum(case when bt.bIsInput=1 then coalesce(bi.Qty,0) when bt.bIsOutput=1 then -coalesce(bi.Qty,0) else 0 end) as qty
  from dbo.bi000 bi
  join dbo.bu000 u on u.GUID=bi.ParentGUID
  join dbo.bt000 bt on bt.GUID=u.TypeGUID
  group by bi.MatGUID,bi.StoreGUID
), stock_by_material as (
  select MatGUID,sum(qty) as stock_qty_net,sum(case when qty>0 then qty else 0 end) as stock_qty_positive
  from per_store group by MatGUID
)
select cast(mt.Number as nvarchar(32)) as item_number,cast(mt.GUID as nvarchar(36)) as item_guid,mt.Name as item_name,
 nullif(ltrim(rtrim(gr.Name)),'') as group_name,
 cast(case when coalesce(stock.stock_qty_positive,0)>0 then stock.stock_qty_positive else coalesce(stock.stock_qty_net,mt.Qty,0) end as decimal(18,3)) as stock_qty,
 cast(coalesce(stock.stock_qty_net,mt.Qty,0) as decimal(18,3)) as stock_qty_net,
 cast(coalesce(stock.stock_qty_positive,0) as decimal(18,3)) as stock_qty_positive,
 nullif(ltrim(rtrim(mt.Unity)),'') as unit1_name,nullif(ltrim(rtrim(mt.Unit2)),'') as unit2_name,
 cast(case when coalesce(mt.Unit2Fact,0)>0 then mt.Unit2Fact else 1 end as decimal(18,3)) as unit2_factor
from dbo.mt000 mt left join dbo.gr000 gr on gr.GUID=mt.GroupGUID left join stock_by_material stock on stock.MatGUID=mt.GUID
where mt.Name is not null and ltrim(rtrim(mt.Name))<>'' order by mt.Number,mt.Name;
