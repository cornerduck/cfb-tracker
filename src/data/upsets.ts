import type { SeasonModel } from './model'
import type { Game } from './types'

// Every upset of a season, biggest spread first (FCS wins over FBS first).
export function seasonUpsets(model: SeasonModel) {
  return model.games.filter((game) => game.status === 'final')
    .map((game) => ({ game, upset: model.upset(game) }))
    .filter((entry): entry is { game: Game; upset: NonNullable<ReturnType<SeasonModel['upset']>> } => entry.upset !== null)
    .sort((a, b) => (b.upset.winnerSpread ?? 99) - (a.upset.winnerSpread ?? 99))
}
