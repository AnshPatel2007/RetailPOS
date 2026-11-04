import { planStoreAssignments } from '../utils/storeAssignmentPlan';

describe('planStoreAssignments', () => {
  const usage = [
    { recordId: 'clothing', locationId: 'ap', uses: 1 },
    { recordId: 'drinks', locationId: 'ap', uses: 3 },
    { recordId: 'drinks', locationId: 'nelson', uses: 1 },
    { recordId: 'drinks', locationId: 'ap', uses: 2 },
  ];

  it('assigns a record used by exactly one store to that store', () => {
    expect(planStoreAssignments(['clothing'], usage, { splitShared: true })).toEqual([{ recordId: 'clothing', action: 'ASSIGN', locationId: 'ap' }]);
  });

  it('keeps a shared category at the busiest store and copies it for the others', () => {
    expect(planStoreAssignments(['drinks'], usage, { splitShared: true })).toEqual([{ recordId: 'drinks', action: 'SPLIT', locationId: 'ap', copyTo: ['nelson'] }]);
  });

  it('leaves records that cannot be copied (customers, suppliers) for review when several stores use them', () => {
    expect(planStoreAssignments(['drinks'], usage, { splitShared: false })).toEqual([{ recordId: 'drinks', action: 'AMBIGUOUS', locationIds: ['ap', 'nelson'] }]);
  });

  it('never guesses a store for an unused record unless one is named', () => {
    expect(planStoreAssignments(['unused'], usage, { splitShared: true })).toEqual([{ recordId: 'unused', action: 'UNUSED' }]);
    expect(planStoreAssignments(['unused'], usage, { splitShared: true, unusedTo: 'nelson' })).toEqual([{ recordId: 'unused', action: 'ASSIGN', locationId: 'nelson' }]);
  });

  it('ignores rows without a store or uses', () => {
    expect(planStoreAssignments(['x'], [{ recordId: 'x', locationId: '', uses: 4 }, { recordId: 'x', locationId: 'ap', uses: 0 }], { splitShared: true }))
      .toEqual([{ recordId: 'x', action: 'UNUSED' }]);
  });
});
