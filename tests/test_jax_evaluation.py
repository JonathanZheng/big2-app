import numpy as np
from experiments.jax_big2.evaluate import summary


def test_paired_confidence_uses_deals_not_individual_games():
    result = summary([0, 2] * 500, [0, 1] * 500)
    paired = result['paired_2v2']
    assert paired['win_rate'] == .5
    assert paired['independent_deals'] == 1000
    margin = np.sqrt(np.log(40) / 2000)
    np.testing.assert_allclose(paired['ci95'], [.5-margin, .5+margin])
    assert paired['verdict'] == 'unclear'


def test_verdicts_and_small_sample_uncertainty():
    assert summary([2], [1])['paired_2v2']['verdict'] == 'unclear'
    assert summary([2]*1000, [1]*1000)['paired_2v2']['verdict'] == 'better'
    assert summary([0]*1000, [0]*1000)['solo_1v3']['verdict'] == 'worse'
