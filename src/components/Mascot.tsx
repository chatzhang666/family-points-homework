const mascotImages = {
  hello: "/characters/girl-mascot.png",
  party: "/characters/girl-mascot.png",
  points: "/characters/girl-points.png",
  shop: "/characters/blue-reward-dog.png"
} as const;

export function Mascot({ mood = "hello" }: { mood?: keyof typeof mascotImages }) {
  return (
    <span className={`mascot mascot-${mood}`} aria-hidden="true">
      {(mood === "party" || mood === "points") && (
        <>
          <span className="character-star first">★</span>
          <span className="character-star second">★</span>
        </>
      )}
      <img src={mascotImages[mood]} alt="" />
    </span>
  );
}
