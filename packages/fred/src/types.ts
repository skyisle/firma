export type FredObservation = {
  date: string;
  value: number | null;
};

export type FredSeries = {
  id: string;
  title: string;
  units: string;
  frequency: string;
  seasonal_adjustment: string;
  last_updated: string;
  observation_start: string;
  observation_end: string;
  notes?: string;
};

export type FredSearchResult = {
  id: string;
  title: string;
  units: string;
  frequency: string;
  last_updated: string;
  popularity: number;
};

export type FredSeriesData = {
  series: FredSeries;
  observations: FredObservation[];
};
