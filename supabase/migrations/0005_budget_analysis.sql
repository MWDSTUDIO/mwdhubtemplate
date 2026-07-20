-- The house's analysis — recomposed by the budget agent at each
-- publication, visible to the couple. Lives on the wedding row.
alter table weddings
  add column budget_analysis text,
  add column budget_analysis_at timestamptz;
