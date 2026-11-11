import SwiftUI

/// Wraps children onto as many lines as needed so no tag is clipped or truncated. Lines are trailing-aligned
/// (matching the hero's bottom-right tag placement); a single over-long tag wraps its own text.
struct DIPTagFlowLayout: Layout {
    var spacing: CGFloat = 8
    var lineSpacing: CGFloat = 8

    private func rows(_ subviews: Subviews, width: CGFloat) -> [[(index: Int, size: CGSize)]] {
        var result: [[(index: Int, size: CGSize)]] = [[]]
        var x: CGFloat = 0
        for index in subviews.indices {
            let size = subviews[index].sizeThatFits(.init(width: width, height: nil))
            if x > 0, x + size.width > width { result.append([]); x = 0 }
            result[result.count - 1].append((index, size))
            x += size.width + spacing
        }
        return result
    }

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let width = proposal.width ?? .infinity
        let rows = rows(subviews, width: width)
        var height: CGFloat = 0, maxWidth: CGFloat = 0
        for row in rows {
            height += row.map(\.size.height).max() ?? 0
            maxWidth = max(maxWidth, row.reduce(0) { $0 + $1.size.width } + spacing * CGFloat(max(0, row.count - 1)))
        }
        height += lineSpacing * CGFloat(max(0, rows.count - 1))
        return CGSize(width: proposal.width ?? maxWidth, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in rows(subviews, width: bounds.width) {
            let rowWidth = row.reduce(0) { $0 + $1.size.width } + spacing * CGFloat(max(0, row.count - 1))
            var x = bounds.maxX - rowWidth
            for item in row {
                subviews[item.index].place(at: CGPoint(x: x, y: y), proposal: .init(width: item.size.width, height: item.size.height))
                x += item.size.width + spacing
            }
            y += (row.map(\.size.height).max() ?? 0) + lineSpacing
        }
    }
}
