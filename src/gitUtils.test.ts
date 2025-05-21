describe('gitUtils', () => {
  it('should return the correct version type', async () => {
    const versionType = await getVersionType('https://github.com/TravelSizedLions/funk.git', 'v0.0.4');
    expect(versionType).toBe('tag');
  });
});

