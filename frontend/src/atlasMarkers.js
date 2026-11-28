// Original Atlas gradients, shared by map pins and legend swatches.
export const markerCategories = {
  event: "radial-gradient(circle, #5b9bd5 0%, #1e5fa8 100%)",
  quest: "radial-gradient(circle, #ffc55a 0%, #d97b10 100%)",
  location: "radial-gradient(circle, #72c272 0%, #2e7d32 100%)",
  city: "radial-gradient(circle, #ffe082 0%, #c79a00 100%)",
  dungeon: "radial-gradient(circle, #9c72d6 0%, #512da8 100%)",
  landmark: "radial-gradient(circle, #4ecdc4 0%, #00796b 100%)",
};

export const markerCategory = (row) => row.event_type || row.poi_type;
